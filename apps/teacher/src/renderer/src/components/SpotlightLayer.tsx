import { useState, useRef, useCallback, useEffect } from 'react';
import { ZoomIn, ImagePlus, Save, X, Lightbulb } from 'lucide-react';

// 聚焦层:C30 式「关灯」遮罩 + 可调矩形框。
// 选中矩形区域保持清晰(挖孔),其余全屏覆盖黑色半透明遮罩。
// 矩形框支持:拖拽移动 + 四角/边中点手柄调整大小。
// 工具栏(关灯/放大/插入白板/保存/关闭)跟随矩形框位置展示。

interface Props {
  onClose: () => void;
  // 截取矩形框区域 → 返回 PNG dataURL。opts.hideWindow=false 时主进程保持窗口显示(放大镜用)
  onCapture: (rect: Rect, opts?: { hideWindow?: boolean }) => Promise<string | null>;
  // 插入白板/保存:回调,由父组件处理
  onInsertToWhiteboard?: (rect: Rect) => void;
  onSave?: (rect: Rect) => void;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_W = 60;
const MIN_H = 40;
// 放大镜放大倍数
const ZOOM = 2;

// 手柄类型:四角(双向) + 四边中点(单向)
type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export default function SpotlightLayer({ onClose, onCapture, onInsertToWhiteboard, onSave }: Props) {
  // 矩形框(逻辑坐标,相对窗口)
  const [rect, setRect] = useState<Rect>({
    x: window.innerWidth * 0.2,
    y: window.innerHeight * 0.2,
    w: window.innerWidth * 0.6,
    h: window.innerHeight * 0.6,
  });
  // 模式:'off' = 普通(挖孔透出桌面) | 'magnify' = 放大镜(框内内容放大)
  const [mode, setMode] = useState<'off' | 'magnify'>('off');
  // 关灯开关:true = 四周变暗(遮罩开),false = 开灯(遮罩关,仅保留蓝色框)
  // 默认开灯(不遮罩),点击「关灯」后才变暗聚焦
  const [darkened, setDarkened] = useState(false);
  // 放大镜模式下的框内截图
  const [magnifyImage, setMagnifyImage] = useState<string | null>(null);
  // 截屏期间临时隐藏蓝色边框/手柄装饰(放大镜不 hide 窗口,避免边框/手柄被截入)
  const [hideDecorations, setHideDecorations] = useState(false);
  // 正在截屏中(防止连续触发)
  const capturingRef = useRef(false);
  // 始终同步最新矩形(供指针事件闭包读取,避免 state 闭包过期)
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const dragRef = useRef<{ mode: 'move' | HandlePos; startX: number; startY: number; rect: Rect } | null>(null);

  // 截取当前矩形框内容(用于放大镜显示)
  const refreshMagnify = useCallback(async (r: Rect) => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    try {
      // 先隐藏边框/手柄装饰(下一帧提交后再截),主进程保持窗口显示(hideWindow=false),
      // 避免 hide→show 导致的窗口闪烁与「点击放大/恢复卡死」。
      setHideDecorations(true);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const dataUrl = await onCapture(r, { hideWindow: false });
      if (dataUrl) setMagnifyImage(dataUrl);
    } finally {
      setHideDecorations(false);
      capturingRef.current = false;
    }
  }, [onCapture]);

  // 切换到放大镜:截当前框内容并放大显示
  const enterMagnify = useCallback(() => {
    setMode('magnify');
    refreshMagnify(rectRef.current);
  }, [refreshMagnify]);

  // 放大镜 → 恢复为普通(关灯)视图:清空放大截图、回到 off 模式
  const exitMagnify = useCallback(() => {
    setMode('off');
    setMagnifyImage(null);
  }, []);

  // 鼠标按下:开始拖拽(移动或调整大小)
  const onPointerDown = useCallback(
    (mode: 'move' | HandlePos) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { mode, startX: e.clientX, startY: e.clientY, rect: { ...rect } };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [rect],
  );

  // 鼠标移动:更新矩形
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const r = { ...d.rect };

      if (d.mode === 'move') {
        r.x = d.rect.x + dx;
        r.y = d.rect.y + dy;
      } else {
        // 调整大小:按手柄方向移动对应边
        const m = d.mode;
        if (m.includes('e')) r.w = d.rect.w + dx; // 右边
        if (m.includes('s')) r.h = d.rect.h + dy; // 下边
        if (m.includes('w')) {
          r.x = d.rect.x + dx;
          r.w = d.rect.w - dx;
        }
        if (m.includes('n')) {
          r.y = d.rect.y + dy;
          r.h = d.rect.h - dy;
        }
        // 最小尺寸约束
        if (r.w < MIN_W) {
          if (m.includes('w')) r.x -= MIN_W - r.w;
          r.w = MIN_W;
        }
        if (r.h < MIN_H) {
          if (m.includes('n')) r.y -= MIN_H - r.h;
          r.h = MIN_H;
        }
      }

      // 边界约束(不拖出屏幕)
      r.x = Math.max(0, Math.min(r.x, window.innerWidth - r.w));
      r.y = Math.max(0, Math.min(r.y, window.innerHeight - r.h));

      setRect(r);
    },
    [],
  );

  // 鼠标松开:结束拖拽;放大镜模式下重新截取新框内容
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    // 放大镜模式:框移动/缩放结束后刷新放大内容(读取最新 rect)
    if (d && mode === 'magnify') {
      refreshMagnify(rectRef.current);
    }
  }, [mode, refreshMagnify]);

  // 关闭时清理(ESC 键退出)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handles: { pos: HandlePos; style: React.CSSProperties }[] = [
    { pos: 'nw', style: { left: -5, top: -5, cursor: 'nwse-resize' } },
    { pos: 'n', style: { left: '50%', top: -5, transform: 'translateX(-50%)', cursor: 'ns-resize' } },
    { pos: 'ne', style: { right: -5, top: -5, cursor: 'nesw-resize' } },
    { pos: 'e', style: { right: -5, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
    { pos: 'se', style: { right: -5, bottom: -5, cursor: 'nwse-resize' } },
    { pos: 's', style: { left: '50%', bottom: -5, transform: 'translateX(-50%)', cursor: 'ns-resize' } },
    { pos: 'sw', style: { left: -5, bottom: -5, cursor: 'nesw-resize' } },
    { pos: 'w', style: { left: -5, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
  ];

  // 菜单尺寸(用于定位,估算)
  const MENU_W = 5 * 60 + 4 * 6 + 24; // 约 348
  const MENU_H = 72;
  const GAP = 16;
  // 菜单优先放框下方,空间不足则放框上方
  const below = rect.y + rect.h + GAP;
  const menuTop = below + MENU_H <= window.innerHeight ? below : Math.max(8, rect.y - GAP - MENU_H);
  const menuLeft = Math.max(8, Math.min(rect.x + rect.w / 2 - MENU_W / 2, window.innerWidth - MENU_W - 8));

  return (
    <div
      data-interactive
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      {/* 挖孔遮罩:利用超大 box-shadow 实现「四周黑、中间透」的关灯效果 */}
      <div
        onPointerDown={onPointerDown('move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: 'absolute',
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          border: hideDecorations ? '2px solid transparent' : '2px solid #3b82f6',
          boxShadow: darkened ? '0 0 0 9999px rgba(0,0,0,0.92)' : 'none',
          cursor: 'move',
          boxSizing: 'border-box',
        }}
      >
        {/* 放大镜:框内内容放大显示(像放大镜,不是放大框本身) */}
        {mode === 'magnify' && magnifyImage && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              pointerEvents: 'none',
              background: '#000',
            }}
          >
            <img
              src={magnifyImage}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: rect.w,
                height: rect.h,
                objectFit: 'fill',
                transform: `scale(${ZOOM})`,
                transformOrigin: 'center center',
                userSelect: 'none',
              }}
            />
          </div>
        )}

        {/* 四角/边中点手柄 */}
        {!hideDecorations && handles.map((h) => (
          <div
            key={h.pos}
            onPointerDown={onPointerDown(h.pos)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
              position: 'absolute',
              width: 10,
              height: 10,
              background: '#3b82f6',
              borderRadius: 2,
              ...h.style,
            }}
          />
        ))}
      </div>

      {/* 工具栏:跟随矩形框位置(框下方/上方),不再固定底部居中 */}
      <div
        style={{
          position: 'absolute',
          top: menuTop,
          left: menuLeft,
          display: 'flex',
          gap: 6,
          padding: '8px 12px',
          borderRadius: 18,
          background: '#1b1b1f',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          zIndex: 91,
        }}
      >
        <SpotBtn
          icon={<Lightbulb size={20} />}
          label={darkened ? '开灯' : '关灯'}
          active={darkened}
          onClick={() => setDarkened((v) => !v)}
        />
        {mode === 'magnify' ? (
          <SpotBtn icon={<ZoomIn size={20} />} label="恢复" active onClick={exitMagnify} />
        ) : (
          <SpotBtn icon={<ZoomIn size={20} />} label="放大" onClick={enterMagnify} />
        )}
        <SpotBtn icon={<ImagePlus size={20} />} label="插入白板" onClick={() => onInsertToWhiteboard?.(rect)} />
        <SpotBtn icon={<Save size={20} />} label="保存" onClick={() => onSave?.(rect)} />
        <SpotBtn icon={<X size={20} />} label="关闭" onClick={onClose} danger />
      </div>
    </div>
  );
}

function SpotBtn({
  icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: 60,
        height: 56,
        borderRadius: 12,
        border: 'none',
        cursor: 'pointer',
        background: active ? 'rgba(255,255,255,0.2)' : 'transparent',
        color: danger ? '#f87171' : active ? '#fff' : '#9ca3af',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        outline: 'none',
        padding: 0,
        transition: 'background .15s ease',
      }}
    >
      {icon}
      <span style={{ fontSize: 11, lineHeight: 1 }}>{label}</span>
    </button>
  );
}
