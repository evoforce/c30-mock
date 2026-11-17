# 资源库(课件)功能设计

> "课件"实为资源库/网盘功能,分三类:课件(PPT/Word)、微课(视频)、板书(录制的白板)。

## 一、资源分类

| 分类 | 支持格式 | 说明 |
|---|---|---|
| 课件 Courseware | PPT/PPTX、Word/DOCX | 教学演示文档 |
| 微课 MicroCourse | MP4、WebM 等视频 | 录制微课视频 |
| 板书 BoardRecord | 白板录制数据(JSON/自定义) | 白板保存能力,可回放 |

## 二、M2 边界

M2 只做:**资源库框架 + 上传 + 列表展示**。

后置(不做):
- 课件解析预览(PPT 转图片、Word 渲染)
- 微课视频播放
- 板书回放
- 学生端跟随/同步(属于后续里程碑)

## 三、数据模型

```
Resource {
  id, ownerId(教师), type[COURSEWARE|MICROCOURSE|BOARD],
  title, fileKey(MinIO), fileSize, mimeType,
  pageCount(课件/板书可选), createdAt
}
```

## 四、后端接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /resource/upload | 上传资源(multipart) |
| GET | /resource?type= | 按类型列表 |
| GET | /resource/:id | 资源详情 |
| DELETE | /resource/:id | 删除资源 |
| GET | /resource/:id/file | 文件预签名 URL |

## 五、存储

- 文件存 MinIO(`courseware` bucket),key 含类型前缀:`{type}/{uuid}.{ext}`
- 元数据存 PostgreSQL(`Resource` 表)
- Demo 阶段 MinIO 可用本地磁盘兜底(未部署 MinIO 时)

## 六、验收标准(M2)

**P0(必须)**
1. 教师端资源库页有三大分类(课件/微课/板书)切换
2. 每类可上传文件,显示文件名、大小、时间
3. 上传后列表实时刷新
4. 后端正确存储元数据 + 文件

**P1(尽量)**
5. 删除资源
6. 空状态提示
7. 上传进度提示

**P2(加分)**
8. 文件类型图标区分
9. 课件显示页数(解析后)
