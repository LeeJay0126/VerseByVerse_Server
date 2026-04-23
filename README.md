# VerseByVerse Server

Express/MongoDB backend for VerseByVerse. It provides authentication, notes, Korean Bible passage proxying, communities, posts, replies, Bible study shares, polls, notifications, and uploaded community hero images.

## Requirements

- Node.js
- npm
- MongoDB connection string
- SMTP credentials for verification and password reset emails

## Getting Started

Install dependencies:

```bash
npm install
```

Create environment files:

```bash
cp .env.example .env
cp .env.local.example .env.local
```

For local frontend development, `.env.local` should include:

```env
PORT=4000
HOST=0.0.0.0
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:3000
APP_URL=http://localhost:3000
```

Start the server:

```bash
npm start
```

For development with nodemon:

```bash
npm run dev
```

Check the server:

```bash
GET http://localhost:4000/health
```

## Environment Loading

The server loads `.env` first, then overrides with `.env.local` if present. This allows production-like defaults in `.env` and machine-specific local values in `.env.local`.

Important variables:

- `PORT` defaults to `4000`
- `HOST` defaults to `0.0.0.0`
- `MONGO_URI` is required
- `SESSION_SECRET` is required for secure sessions
- `CLIENT_ORIGIN` and `CLIENT_ORIGINS` control CORS
- `APP_URL` is used for email verification and password reset links
- `SMTP_*` values are required for email delivery

## Authentication

Auth routes are mounted under `/auth`.

Main routes:

- `POST /auth/signup`
- `GET /auth/verify-email`
- `POST /auth/resend-verification`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/change-password`

Login uses `express-session` with MongoDB-backed session storage. Session cookies are HTTP-only, refresh during active use, and expire after 2 hours. Email verification links expire after 5 minutes. Verification resend is rate-limited by a 60-second cooldown.

### Authentication Limits

Signup and account routes enforce these backend rules:

- First name and last name are required on signup, normalized for whitespace, and limited to 20 characters each.
- Email is required, trimmed, lowercased, limited to 254 characters, must match a basic `name@domain.tld` shape, and must be unique.
- Username is required, trimmed, lowercased, unique, and must be 4 to 20 characters.
- Username characters are limited to letters, numbers, periods, and underscores.
- Usernames cannot start or end with `.` or `_`.
- Usernames cannot contain `..`, `__`, `._`, or `_.`.
- Passwords are required and must be 10 to 72 characters.
- Passwords cannot be in the built-in common-password list.
- Password strength must pass `zxcvbn` with a score of at least 3, checked against username, email, first name, last name, and the email local-part.
- Email verification tokens last 5 minutes.
- Verification resend is blocked for 60 seconds after a successful send; after that cooldown, resend issues a fresh token and email.
- Password reset tokens last 30 minutes.
- Password reset requests use a 60-second cooldown and avoid account enumeration by returning success when no matching user exists.
- Login is blocked until the account email is verified.
- Change-password requires the current password, a valid new password, and the new password must be different from the current password.

## API Areas

### Health

- `GET /health`

### Korean Bible Passage Proxy

Mounted under `/api`.

- `GET /api/passage/kor/:chapterId`

Example:

```bash
GET /api/passage/kor/ge.1
```

The Korean route fetches from `ibibles.net` and returns a normalized passage payload.

### Users

Mounted under `/users`.

- `GET /users/me`
- `PATCH /users/me`

Requires verified authentication.

### Notes

Mounted under `/notes`.

- `GET /notes/list`
- `GET /notes/exists`
- `GET /notes/:id`
- `PUT /notes/:id`
- `DELETE /notes/:id`
- `GET /notes`
- `POST /notes`

### Communities

Mounted under `/community`.

Community routes include:

- create community
- list joined communities
- discover communities
- get community detail
- invite users
- request to join
- accept/reject join requests
- manage members
- upload hero image
- manage notification preferences

Post routes include:

- list posts
- create posts
- get post detail
- edit/delete posts
- vote on polls

Reply and Bible study share routes include:

- list replies
- create replies and sub-replies
- edit/delete replies
- get current user's Bible study submission
- create/update Bible study submission share

### Notifications

Mounted under `/notifications`.

- list notifications
- mark one as read
- mark all as read
- act on actionable notifications
- delete one or all notifications

## Sessions and CORS

Local development supports `http://localhost:3000` through `.env.local`.

Production allows configured client origins and uses secure cookies with `sameSite=none`.

Unexpected server errors are logged internally. Production responses hide internal error details and return a generic JSON error.

## Tests

Run tests:

```bash
npm test
```

Current tests cover:

- Bible study share body formatting
- pagination sanitization
- verification/reset email URL generation
- email template text sanity checks

## Scripts

- `npm start` runs `node server.js`
- `npm run dev` runs `nodemon server.js`
- `npm test` runs Node's built-in test runner
