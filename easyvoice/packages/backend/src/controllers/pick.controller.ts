import { NextFunction, Response, Request } from 'express'
import { validateEdge, validateLLM } from '../schema/generate'

export const pickSchema = (req: Request, res: Response, next: NextFunction) => {
  const { useLLM } = req.body
  if (useLLM) {
    validateLLM(req, res, next)
  } else {
    validateEdge(req, res, next)
  }
}

