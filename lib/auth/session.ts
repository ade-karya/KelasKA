import { auth } from "@/auth";
import { db } from "@/lib/db";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  tenants: {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    role: string;
  }[];
};

/**
 * Get the current authenticated user with their tenant memberships.
 * Returns null if the user is not authenticated.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      avatar: true,
      tenants: {
        select: {
          tenantId: true,
          role: true,
          tenant: {
            select: {
              name: true,
              slug: true,
            },
          },
        },
      },
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    tenants: user.tenants.map((t) => ({
      tenantId: t.tenantId,
      tenantName: t.tenant.name,
      tenantSlug: t.tenant.slug,
      role: t.role,
    })),
  };
}

/**
 * Get the user's primary (first) tenant ID.
 * Returns null if the user has no tenants.
 */
export async function getUserPrimaryTenantId(userId: string): Promise<string | null> {
  const tenantUser = await db.tenantUser.findFirst({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    select: { tenantId: true },
  });
  return tenantUser?.tenantId ?? null;
}

/**
 * Check if a user has a specific role in any of their tenants.
 */
export async function userHasRole(userId: string, role: string): Promise<boolean> {
  const count = await db.tenantUser.count({
    where: { userId, role: role as any },
  });
  return count > 0;
}
