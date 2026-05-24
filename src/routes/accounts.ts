// import { omit } from '@repo/utils/helpers';
// import bcrypt from 'bcryptjs';
// import { Elysia} from 'elysia';
// import { z } from 'zod';
// import { setup } from '@/setup';
// import { signJwt } from '@/utils/auth';
// import { HttpError } from '@/utils/errors';
// import { authenticate } from '@/utils/helpers';

// export const accounts = new Elysia({ prefix: '/accounts', tags: ['Accounts'] })
//   .use(setup)

//   .post(
//     '/login',
//     async ({ t, prisma, body: { username, password } }) => {
//       const user = await prisma.user.findUnique({ where: { username } });

//       const err = new HttpError({
//         message: t({
//           en: 'Unable to login with provided credentials',
//           ar: 'لا يمكن تسجيل الدخول بالبيانات المقدمة',
//         }),
//       });

//       if (!user) {
//         throw err;
//       }

//       const isPasswordValid = await bcrypt.compare(password, user.password);

//       if (!isPasswordValid) {
//         throw err;
//       }

//       const token = await signJwt({
//         id: user.id,
//         username: user.username,
//       });

//       return { token };
//     },
//     {
//       body: z.object({
//         username: z.string(),
//         password: z.string(),
//       }),
//     },
//   )

//   .post(
//     '/register',
//     async ({ t, prisma, body }) => {
//       const user = await prisma.user.findUnique({
//         where: { username: body.username },
//       });

//       if (user) {
//         throw new HttpError({
//           message: t({
//             en: 'User already exists',
//             ar: 'المستخدم موجود بالفعل',
//           }),
//         });
//       }

//       const hashedPassword = await bcrypt.hash(body.password, 12);

//       return prisma.user.create({
//         data: {
//           ...body,
//           password: hashedPassword,
//         },
//       });
//     },
//     {
//       body: z.object({
//         username: z.string(),
//         password: z.string(),
//         name: z.string(),
//         phone: z.string(),
//         birthDate: t.Date(),
//         avatarId: t.Optional(z.uuid()),
//       }),
//     },
//   )

//   .get(
//     '/profile',
//     async ({ t, prisma, bearer }) => {
//       const user = await authenticate({
//         token: bearer || '',
//         errorMessage: t({
//           en: 'Authentication required',
//           ar: 'مطلوب التحقق من الهوية',
//         }),
//       });

//       const profile = await prisma.user.findUnique({
//         where: { id: user.id },
//         include: { avatar: { select: { url: true } } },
//       });

//       if (!profile) {
//         throw new HttpError({
//           statusCode: 404,
//           message: t({
//             en: 'Profile not found',
//             ar: 'الملف الشخصي غير موجود',
//           }),
//         });
//       }

//       return omit(profile, ['password']);
//     },
//     {},
//   );
