'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@splitwise/ui';
import { FormAlert, TextField } from '@/components/forms/text-field';
import { useRegister } from '@/hooks/use-auth';
import { describeAuthError } from '@/lib/auth-api';
import { registerSchema, type RegisterFormValues } from '@/lib/auth-schemas';

export function RegisterForm() {
  const router = useRouter();
  const registerMutation = useRegister();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit((values) => {
    registerMutation.mutate(values, { onSuccess: () => router.replace('/dashboard') });
  });
  const isSubmitting = registerMutation.isPending || registerMutation.isSuccess;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>Track shared expenses with friends and groups.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {registerMutation.isError ? (
            <FormAlert>{describeAuthError(registerMutation.error)}</FormAlert>
          ) : null}
          <TextField
            id="name"
            label="Name"
            autoComplete="name"
            error={errors.name?.message}
            {...register('name')}
          />
          <TextField
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <TextField
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-slate-900 underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
