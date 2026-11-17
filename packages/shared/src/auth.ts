// 用户角色
export type Role = 'TEACHER' | 'STUDENT';

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}
