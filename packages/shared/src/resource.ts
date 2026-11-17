// 资源库:课件(PPT/Word)、微课(视频)、板书(录制白板)
export type ResourceType = 'COURSEWARE' | 'MICROCOURSE' | 'BOARD';

export interface Resource {
  id: string;
  ownerId: string;
  type: ResourceType;
  title: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
  pageCount?: number;
  createdAt: string;
}

export interface ResourceListResponse {
  items: Resource[];
  total: number;
}
