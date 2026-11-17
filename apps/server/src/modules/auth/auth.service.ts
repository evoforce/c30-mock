import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginRequest, LoginResponse, Role } from '@c30/shared';

interface MockUser {
  id: string;
  username: string;
  password: string;
  name: string;
  role: Role;
}

// Demo 阶段:Mock 种子账号(后续替换为 PostgreSQL 用户表)
const MOCK_USERS: MockUser[] = [
  { id: 'u-teacher-1', username: 'teacher', password: '123456', name: '王老师', role: 'TEACHER' },
  { id: 'u-student-1', username: 'student', password: '123456', name: '小明', role: 'STUDENT' },
];

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async login(req: LoginRequest): Promise<LoginResponse> {
    const user = MOCK_USERS.find(
      (u) => u.username === req.username && u.password === req.password,
    );
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    const token = this.jwtService.sign({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
    return {
      token,
      user: { id: user.id, username: user.username, name: user.name, role: user.role },
    };
  }
}
