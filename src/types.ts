import type { Role } from '@prisma/client';

export interface AuthPayload {
  id: string;
  email: string;
  username: string;
  name: string;
  role: Role;
}
