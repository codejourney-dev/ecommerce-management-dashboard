
import type { Request, Response, NextFunction } from "express";
import { serializeBigInt } from "../utils/serialize-bigint.js"
import {
  FulfillmentType,
  OrderSource,
  OrderStatus,
} from "../../generated/prisma/client.js";

import {
  listOrders,
  getOrderById,
  type OrderListQuery,
} from "../services/order.service.js";
import { from } from "node:stream/iter";

// --------------------------------------------------
// Controller Error
// --------------------------------------------------

class OrderControllerError extends Error {
  statusCode: number;
  code: string;

  constructor(
    message: string,
    code: string,
    statusCode: number = 400
  ) {
    super(message);

    this.name = "OrderControllerError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// --------------------------------------------------
// Query Helpers
// --------------------------------------------------

function getQueryString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function getQueryNumber(
  value: unknown,
  fieldName: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new OrderControllerError(
      `Invalid ${fieldName}.`,
      "INVALID_QUERY_PARAMETER"
    );
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new OrderControllerError(
      `${fieldName} must be a positive integer.`,
      "INVALID_QUERY_PARAMETER"
    );
  }

  return parsedValue;
}
function getQueryDate(
  value: unknown,
  fieldName: string
): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new OrderControllerError(
      `Invalid ${fieldName}.`,
      "INVALID_QUERY_PARAMETER"
    );
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new OrderControllerError(
      `Invalid ${fieldName}.`,
      "INVALID_QUERY_PARAMETER"
    );
  }

  return parsedDate;
}

function getQueryEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    !allowedValues.includes(value as T)
  ) {
    throw new OrderControllerError(
      `Invalid ${fieldName}.`,
      "INVALID_QUERY_PARAMETER"
    );
  }

  return value as T;
}

// --------------------------------------------------
// GET /orders
// --------------------------------------------------

export const getOrders = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const query: OrderListQuery = {
      page: getQueryNumber(req.query.page, "page"),
      limit: getQueryNumber(req.query.limit, "limit"),

      search: getQueryString(req.query.search),

      status: getQueryEnum(
        req.query.status,
        Object.values(OrderStatus),
        "status"
      ),

      source: getQueryEnum(
        req.query.source,
        Object.values(OrderSource),
        "source"
      ),

      fulfillmentType: getQueryEnum(
        req.query.fulfillmentType,
        Object.values(FulfillmentType),
        "fulfillmentType"
      ),

      customerId: getQueryString(req.query.customerId),

      createdByAdminId: getQueryString(
        req.query.createdByAdminId
      ),

      startDate: getQueryDate(req.query.startDate, "startDate"),

      endDate: getQueryDate(req.query.endDate, "endDate"),
    };

    const result = await listOrders(query);

    return res.status(200).json({
      success: true,
      data: serializeBigInt(result.orders),
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// --------------------------------------------------
// GET /orders/:id
// --------------------------------------------------

export const getOrderByIdController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = req.params.id;

    if (typeof id !== "string" || !id.trim()) {
    throw new OrderControllerError(
        "Order ID is required.",
        "ORDER_ID_REQUIRED"
    );
    }

    const order = await getOrderById(id);

    return res.status(200).json({
      success: true,
      data: serializeBigInt(order),
    });
  } catch (error) {
    next(error);
  }
};
