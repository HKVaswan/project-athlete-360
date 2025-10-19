// src/middleware/validation.middleware.ts
import { Request, Response, NextFunction } from "express";

export function validate(schema: any) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      const messages = error.details.map((d: any) => d.message);
      return res.status(400).json({ success: false, errors: messages });
    }
    next();
  };
}
