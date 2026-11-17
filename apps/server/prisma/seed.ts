import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

function hashPassword(pwd: string): string {
  return createHash('sha256').update(pwd).digest('hex');
}

async function main() {
  const users = [
    { username: 'teacher', password: '123456', name: '王老师', role: 'TEACHER' },
    { username: 'student', password: '123456', name: '小明', role: 'STUDENT' },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: {
        username: u.username,
        passwordHash: hashPassword(u.password),
        name: u.name,
        role: u.role as any,
      },
    });
  }

  console.log('Seed 完成:teacher / student,密码 123456');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
