
import { prisma } from "../config/prisma.js";
//checks whether the user possesses the required permission through at least one of their roles.
export async function hasPermission(
  adminUserId: string,
  permissionName: string
): Promise<boolean> {
  const permission = await prisma.permission.findFirst({
    where: {
      name: permissionName,

      rolePermissions: {
        some: {
          role: {
            adminUserRoles: {
              some: {
                adminUserId,
                adminUser: {
                  status: "ACTIVE",
                  deletedAt: null,
                  phoneVerifiedAt: {
                    not: null,
                  },
                },
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
    },
  });

  return permission !== null;
}
