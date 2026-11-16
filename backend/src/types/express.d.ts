import "express";

declare global {
  namespace Express {
    interface Request {
      adminAuth?: {
        adminUserId: string;
        sessionId: string;
      };
    }
  }
}

export {};
