import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { nanoid } from "nanoid";

export async function POST(req: Request) {
  try {
    const { name, email, password } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Nama, email, dan kata sandi wajib diisi" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Kata sandi minimal harus 6 karakter" },
        { status: 400 }
      );
    }

    // Check if user exists
    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Email sudah terdaftar" },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user and their default tenant in a transaction
    const result = await db.$transaction(async (tx) => {
      // 1. Create User
      const user = await tx.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
        },
      });

      // 2. Create personal Tenant
      const tenantSlug = `${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${nanoid(5)}`;
      const tenant = await tx.tenant.create({
        data: {
          name: `Kelas ${name}`,
          slug: tenantSlug,
          plan: "FREE",
        },
      });

      // 3. Link User to Tenant as ADMIN
      await tx.tenantUser.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          role: "ADMIN",
        },
      });

      return { user, tenant };
    });

    return NextResponse.json(
      {
        message: "Registrasi berhasil",
        userId: result.user.id,
        tenantId: result.tenant.id,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan internal server" },
      { status: 500 }
    );
  }
}
