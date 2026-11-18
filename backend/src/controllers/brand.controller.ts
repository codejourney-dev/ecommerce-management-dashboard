
import type { Request, Response, NextFunction } from "express";
import {
    BrandServiceError,
    createBrand,
    listBrands,
    getBrandById,
    updateBrand,
    updateBrandStatus,
    deleteBrand,
    setBrandCategories,
    getAvailableBrandsByCategory,
} from "../services/brand.service.js";

function parseBoolean(value: unknown): boolean | undefined {
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return undefined;
}

function parsePositiveInteger(
    value: unknown,
    defaultValue: number
): number {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1) {
        return defaultValue;
    }

    return parsed;
}

function getParamId(req: Request, res: Response): string | null {
    const id = req.params.id;

    if (typeof id !== "string" || !id.trim()) {
        res.status(400).json({
            success: false,
            message: "A valid ID is required.",
            code: "INVALID_ID",
        });

        return null;
    }

    return id;
}

function handleControllerError(
    error: unknown,
    res: Response,
    next: NextFunction
) {
    if (error instanceof BrandServiceError) {
        return res.status(error.statusCode).json({
            success: false,
            message: error.message,
            code: error.code,
        });
    }

    return next(error);
}

export async function createBrandController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { name, slug, isActive } = req.body;

        if (
            typeof name !== "string" ||
            !name.trim() ||
            typeof slug !== "string" ||
            !slug.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "Name and slug are required.",
                code: "INVALID_BRAND_INPUT",
            });
        }

        if (
            isActive !== undefined &&
            typeof isActive !== "boolean"
        ) {
            return res.status(400).json({
                success: false,
                message: "isActive must be a boolean.",
                code: "INVALID_IS_ACTIVE",
            });
        }

        const brand = await createBrand({
            name,
            slug,
            isActive,
        });

        return res.status(201).json({
            success: true,
            message: "Brand created successfully.",
            data: brand,
        });
    } catch (error) {
        return handleControllerError(error, res, next);
    }
}

export async function listBrandsController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const page = parsePositiveInteger(req.query.page, 1);
        const limit = parsePositiveInteger(req.query.limit, 25);
        const isActive = parseBoolean(req.query.isActive);

        if (
            req.query.isActive !== undefined &&
            isActive === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "isActive must be true or false.",
                code: "INVALID_IS_ACTIVE",
            });
        }

        const search =
            typeof req.query.search === "string"
                ? req.query.search.trim()
                : undefined;

        const result = await listBrands({
            page,
            limit,
            search,
            isActive,
        });

        return res.status(200).json({
            success: true,
            data: result.brands,
            pagination: result.pagination,
        });
    } catch (error) {
        return handleControllerError(error, res, next);
    }
}

export async function getBrandByIdController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const id = getParamId(req, res);
        if (!id) return;
        const brand = await getBrandById(id);

        return res.status(200).json({
            success: true,
            data: brand,
        });
    } catch (error) {
        return handleControllerError(error, res, next);
    }
}

export async function updateBrandController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { name, slug } = req.body;
        const id = getParamId(req, res);
        if (!id) return;

        if (name === undefined && slug === undefined) {
            return res.status(400).json({
                success: false,
                message: "At least one field must be provided.",
                code: "EMPTY_UPDATE",
            });
        }

        if (
            name !== undefined &&
            (typeof name !== "string" || !name.trim())
        ) {
            return res.status(400).json({
                success: false,
                message: "Name must be a non-empty string.",
                code: "INVALID_BRAND_NAME",
            });
        }

        if (
            slug !== undefined &&
            (typeof slug !== "string" || !slug.trim())
        ) {
            return res.status(400).json({
                success: false,
                message: "Slug must be a non-empty string.",
                code: "INVALID_BRAND_SLUG",
            });
        }

        const brand = await updateBrand(id, {
            ...(name !== undefined ? { name } : {}),
            ...(slug !== undefined ? { slug } : {}),
        });

        return res.status(200).json({
            success: true,
            message: "Brand updated successfully.",
            data: brand,
        });
    } catch (error) {
        return handleControllerError(error, res, next);
    }
}

export async function updateBrandStatusController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { isActive } = req.body;
        const id = getParamId(req, res);
        if (!id) return;

        if (typeof isActive !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "isActive must be a boolean.",
                code: "INVALID_IS_ACTIVE",
            });
        }

        const brand = await updateBrandStatus(id,isActive);

        return res.status(200).json({
            success: true,
            message: isActive
                ? "Brand activated successfully."
                : "Brand deactivated successfully.",
            data: brand,
        });
    } catch (error) {
        return handleControllerError(error, res, next);
    }
}

export async function deleteBrandController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const id = getParamId(req, res);
        if (!id) return;
        await deleteBrand(id);

        return res.status(200).json({
            success: true,
            message: "Brand deleted successfully.",
        });
    } catch (error) {
        return handleControllerError(error, res, next);
    }
}

export async function setBrandCategoriesController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { categoryIds } = req.body;
        const id = getParamId(req, res);
        if (!id) return;

        if (
            !Array.isArray(categoryIds) ||
            !categoryIds.every(
                (id: unknown) =>
                    typeof id === "string" && id.trim().length > 0
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "categoryIds must be an array of category IDs.",
                code: "INVALID_CATEGORY_IDS",
            });
        }

        const brand = await setBrandCategories(id,categoryIds);

        return res.status(200).json({
            success: true,
            message: "Brand categories updated successfully.",
            data: brand,
        });
    } catch (error) {
        return handleControllerError(error, res, next);
    }
}

export async function getAvailableBrandsByCategoryController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const categoryId =
            typeof req.query.categoryId === "string"
                ? req.query.categoryId
                : "";

        if (!categoryId) {
            return res.status(400).json({
                success: false,
                message: "categoryId is required.",
                code: "CATEGORY_ID_REQUIRED",
            });
        }

        const brands = await getAvailableBrandsByCategory(categoryId);

        return res.status(200).json({
            success: true,
            data: brands,
        });
    } catch (error) {
        return handleControllerError(error, res, next);
    }
}
