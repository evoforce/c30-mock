import { useState, useEffect, useRef } from 'react';
import type { Resource, ResourceType } from '@c30/shared';

const API_BASE = 'http://localhost:3000';

const CATEGORIES: { key: ResourceType; label: string; icon: React.ReactNode }[] = [
  { key: 'COURSEWARE', label: '课件', icon: <IconCourseware /> },
  { key: 'MICROCOURSE', label: '微课', icon: <IconVideo /> },
  { key: 'BOARD', label: '板书', icon: <IconBoard /> },
];

export default function ResourceLibrary({ userId }: { userId: string }) {
  const [active, setActive] = useState<ResourceType>('COURSEWARE');
  const [items, setItems] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchList = async (type: ResourceType) => {
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/resource?type=${type}`);
      const data = await resp.json();
      setItems(data.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList(active);
  }, [active]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await fetch(`${API_BASE}/resource/upload?type=${active}&ownerId=${userId}`, {
        method: 'POST',
        body: form,
      });
      await fetchList(active);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`${API_BASE}/resource/${id}`, { method: 'DELETE' });
    await fetchList(active);
  };

  return (
    <div style={{ display: 'flex', height: '100%', background: '#f7f8fa' }}>
      {/* 左侧分类栏 */}
      <div
        style={{
          width: 160,
          background: '#ffffff',
          borderRight: '1px solid #eef0f3',
          padding: '16px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {CATEGORIES.map((c) => {
          const isActive = active === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setActive(c.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
                background: isActive ? '#eaf1ff' : 'transparent',
                color: isActive ? '#2563eb' : '#4b5563',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                transition: 'all .15s',
                outline: 'none',
              }}
            >
              {c.icon}
              {c.label}
            </button>
          );
        })}
      </div>

      {/* 右侧列表区 */}
      <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 15, color: '#7c8494' }}>
            共 {items.length} 个资源
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              padding: '9px 18px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              cursor: uploading ? 'not-allowed' : 'pointer',
              opacity: uploading ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            {uploading ? '上传中…' : '上传'}
          </button>
          <input
            ref={fileRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleUpload}
          />
        </div>

        {/* 列表 */}
        {loading ? (
          <div style={{ textAlign: 'center', color: '#9aa1ac', marginTop: 60 }}>
            加载中…
          </div>
        ) : items.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#b0b4bb',
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinejoin="round" />
              <path d="M14 2v6h6" strokeLinejoin="round" />
            </svg>
            <div style={{ marginTop: 12, fontSize: 14 }}>暂无资源,点击右上角上传</div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 14,
            }}
          >
            {items.map((r) => (
              <div
                key={r.id}
                style={{
                  background: '#ffffff',
                  borderRadius: 12,
                  padding: 16,
                  border: '1px solid #eef0f3',
                  position: 'relative',
                }}
              >
                {/* 文件类型图标 */}
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: '#eaf1ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#2563eb',
                    marginBottom: 12,
                  }}
                >
                  {getFileIcon(r)}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: '#1f2937',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={r.title}
                >
                  {r.title}
                </div>
                <div style={{ fontSize: 12, color: '#9aa1ac', marginTop: 6 }}>
                  {formatSize(r.fileSize)} · {formatDate(r.createdAt)}
                </div>
                <button
                  onClick={() => handleDelete(r.id)}
                  title="删除"
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: '#b0b4bb',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = '#fef2f2';
                    (e.currentTarget as HTMLButtonElement).style.color = '#e5484d';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = '#b0b4bb';
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getFileIcon(r: Resource) {
  const ext = r.title.split('.').pop()?.toLowerCase();
  if (r.type === 'MICROCOURSE') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="5" width="20" height="14" rx="3" />
        <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (ext === 'ppt' || ext === 'pptx') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M8 12h3a2 2 0 000-4H8v8M16 8v8M13 12h3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (ext === 'doc' || ext === 'docx') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 4a2 2 0 012-2h9l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" strokeLinejoin="round" />
        <path d="M15 2v5h5M8 13h8M8 17h5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h6M7 12h8M7 16h5" strokeLinecap="round" />
    </svg>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function IconCourseware() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 4a2 2 0 012-2h9l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" strokeLinejoin="round" />
      <path d="M15 2v5h5" strokeLinejoin="round" />
    </svg>
  );
}

function IconVideo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconBoard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" strokeLinecap="round" />
    </svg>
  );
}
