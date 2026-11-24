
import {
    FulfillmentType,
    OrderSource,
    OrderStatus,
    Prisma,
} from "../../generated/prisma/client.js";

import { prisma } from "../config/prisma.js";

// Errors

export class OrderServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 400
    ) {
        super(message);
        this.name = "OrderServiceError";
    }
}

// Types

type DbClient = typeof prisma | Prisma.TransactionClient;

export interface OrderListQuery {
    page?: number;
    limit?: number;
    search?: string;
    status?: OrderStatus;
    source?: OrderSource;
    fulfillmentType?: FulfillmentType;
    customerId?: string;
    createdByAdminId?: string;
    startDate?: Date;
    endDate?: Date;
}

// Helpers

function isKnownRequestError(
    error: unknown,
    code: string
): error is Prisma.PrismaClientKnownRequestError {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === code
    );
}

function buildOrderInclude() {
    return {
        customer: {
            select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
                email: true,
            },
        },
        createdByAdmin: {
            select: {
                id: true,
                name: true,
                email: true,
            },
        },
        items: {
            include: {
                variants: {
                    select: {
                        id: true,
                        sku: true,
                        title: true,
                        product: {
                            select: {
                                id: true,
                                name: true,
                                slug: true,
                            },
                        },
                    },
                },
            },
        },
        orderHistory: {
            orderBy: {
                createdAt: "desc" as const,
            },
            include: {
                adminUsers: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        },
        payment: {
            select: {
                id: true,
                method: true,
                status: true,
                amountRial: true,
                createdAt: true,
            },
        },
    } satisfies Prisma.OrderInclude;
}

// List Orders

export async function listOrders(query: OrderListQuery = {}) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;

    const search = query.search?.trim();

    const where: Prisma.OrderWhereInput = {
        ...(query.status !== undefined
            ? { status: query.status }
            : {}),

        ...(query.source !== undefined
            ? { source: query.source }
            : {}),

        ...(query.fulfillmentType !== undefined
            ? { fulfillmentType: query.fulfillmentType }
            : {}),

        ...(query.customerId !== undefined
            ? { customerId: query.customerId }
            : {}),

        ...(query.createdByAdminId !== undefined
            ? { createdByAdminId: query.createdByAdminId }
            : {}),

        ...(search
            ? {
                OR: [
                    {
                        orderNumber: {
                            contains: search,
                            mode: "insensitive",
                        },
                    },
                    {
                        guestCustomerName: {
                            contains: search,
                            mode: "insensitive",
                        },
                    },
                    {
                        guestCustomerPhone: {
                            contains: search,
                            mode: "insensitive",
                        },
                    },
                    {
                        customer: {
                            is: {
                                OR: [
                                    {
                                        firstName: {
                                            contains: search,
                                            mode: "insensitive",
                                        },
                                    },
                                    {
                                        lastName: {
                                            contains: search,
                                            mode: "insensitive",
                                        },
                                    },
                                    {
                                        phone: {
                                            contains: search,
                                            mode: "insensitive",
                                        },
                                    },
                                ],
                            },
                        },
                    },
                ],
            }
            : {}),

        ...(query.startDate || query.endDate
            ? {
                createdAt: {
                    ...(query.startDate
                        ? { gte: query.startDate }
                        : {}),
                    ...(query.endDate
                        ? { lte: query.endDate }
                        : {}),
                },
            }
            : {}),
    };

    const [orders, total] = await prisma.$transaction([
        prisma.order.findMany({
            where,
            skip,
            take: limit,
            orderBy: [
                { createdAt: "desc" },
                { id: "asc" },
            ],
            include: buildOrderInclude(),
        }),

        prisma.order.count({ where }),
    ]);

    return {
        orders,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

// Get Order by ID

export async function getOrderById(id: string) {
    const order = await prisma.order.findUnique({
        where: { id },
        include: buildOrderInclude(),
    });

    if (!order) {
        throw new OrderServiceError(
            "Order not found.",
            "ORDER_NOT_FOUND",
            404
        );
    }

    return order;
}
