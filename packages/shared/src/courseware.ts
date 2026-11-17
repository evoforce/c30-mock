// 课件
export interface Courseware {
  id: string;
  teacherId: string;
  title: string;
  fileKey: string;
  pageCount: number;
  createdAt: string;
}

export interface CoursewareListResponse {
  items: Courseware[];
  total: number;
}
