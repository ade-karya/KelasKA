import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // 1. Create default Tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo" },
    update: {},
    create: {
      name: "Kelas Demo",
      slug: "demo",
      plan: "FREE",
    },
  });
  console.log(`Created tenant: ${tenant.name} (${tenant.slug})`);

  // 2. Create Admin User
  const adminPassword = await bcrypt.hash("admin123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@kelaska.com" },
    update: {},
    create: {
      email: "admin@kelaska.com",
      name: "Admin Demo",
      password: adminPassword,
    },
  });
  console.log(`Created admin user: ${admin.email}`);

  // Link Admin to Tenant as ADMIN
  await prisma.tenantUser.upsert({
    where: {
      userId_tenantId: {
        userId: admin.id,
        tenantId: tenant.id,
      },
    },
    update: { role: "ADMIN" },
    create: {
      userId: admin.id,
      tenantId: tenant.id,
      role: "ADMIN",
    },
  });

  // 3. Create Student User
  const studentPassword = await bcrypt.hash("student123", 10);
  const student = await prisma.user.upsert({
    where: { email: "student@kelaska.com" },
    update: {},
    create: {
      email: "student@kelaska.com",
      name: "Siswa Demo",
      password: studentPassword,
    },
  });
  console.log(`Created student user: ${student.email}`);

  // Link Student to Tenant as STUDENT
  await prisma.tenantUser.upsert({
    where: {
      userId_tenantId: {
        userId: student.id,
        tenantId: tenant.id,
      },
    },
    update: { role: "STUDENT" },
    create: {
      userId: student.id,
      tenantId: tenant.id,
      role: "STUDENT",
    },
  });

  console.log("Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
