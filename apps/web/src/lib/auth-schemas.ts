import { z } from 'zod';

/**
 * Client-side form validation for fast feedback only. The API re-validates
 * every field and is the authority on what is accepted.
 */

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(100, 'Name is too long'),
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email'),
  password: z.string().min(8, 'Use at least 8 characters').max(128, 'Use at most 128 characters'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.infer<typeof registerSchema>;
