import { z } from 'zod';
import { platformIdPattern } from './types.js';

export const sourceNameSchema = z.string().min(1).max(100).regex(platformIdPattern).refine(value => value !== 'external', 'external 是外部材料的保留来源标识');
