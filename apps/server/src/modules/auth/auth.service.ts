import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginRequest, LoginResponse } from '@c30/shared';
import { PrismaService } from '../prisma/prisma.service';
import { createHash } from 'crypto';

function hashPassword(pwd: string): string {
  return createHash('sha256').update(pwd).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async login(req: LoginRequest): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({
      where: { username: req.username },
    });

    if (!user || user.passwordHash !== hashPassword(req.password)) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const token = this.jwtService.sign({
      sub: user.id,
      username: user.username,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      },
    };
  }
}
