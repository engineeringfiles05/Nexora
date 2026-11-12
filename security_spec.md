# Nexora Academy Security Specification

## 1. Data Invariants
- **Identity & Access**:
  - Accounts are Firebase Authentication accounts (email and password, or Google). Firebase stores and hashes passwords; the app never sees or stores them.
  - `isAdmin()` is true only for the site owner, `engineeringfiles05@gmail.com`, with `email_verified == true`. There is no other way to become an administrator (the former `/admins/{uid}` grant was removed). The same rule is applied in the app (`src/auth/roles.ts`) and the API (`server/firebaseAuth.ts`).
  - Every account created through public registration is a reviewee. Nobody chooses a role: `/users/{userId}` accepts `role: 'reviewee'`, and `role: 'admin'` only on the verified owner's own profile.
  - Non-admins can only read and write their own `/users/{userId}` profile, where `{userId} == request.auth.uid`; the profile's email must be the sign-in email, and the id, email and enrolment date can't be changed. Only known fields are accepted, with size limits (name 120, contact number 20 characters; course `REE` or `RME`).
  - Admin API routes (AI extraction and solving) verify the Firebase ID token sent as `Authorization: Bearer`: a reviewee's token gets 403, a forged or expired one 401.
- **Account status and course access** (User Management):
  - Each profile has a `status`: `active`, `inactive`, `suspended` or `pending` (missing = active). Only the administrator changes it; reviewees can't edit their own status, creator, email, enrolment date or (once chosen) course.
  - `isActiveReviewee()` (an existing profile with status `active`) is required to read questions and question sets and to add exam results. Blocked accounts are also signed out by the app as soon as their status changes, and, with `FIREBASE_SERVICE_ACCOUNT` configured, disabled in Firebase Authentication with their sessions revoked.
  - Reviewees read only material whose `course` equals their profile's course (`myCourse()`); material created before courses existed is tagged `REE` when the administrator signs in.
  - While `settings/registration.requireApproval` is true, self-registered profiles must start `pending`.
  - The administrator creates reviewee profiles for others (never admins), and can't block, demote or delete their own account (rules and `/api/admin` both refuse).
  - `/api/admin/*` (email change, sign-in block, Auth account deletion) requires the verified administrator's ID token; the shared AI token is not accepted there.
- **Question Bank**:
  - Only administrators can create, update, or delete `/questions/{questionId}`.
  - Reviewees can read questions only if `resource.data.isPublished == true`.
- **PDF Sources**:
  - Only administrators can create, update, or delete `/pdfSources/{pdfSourceId}`.
  - Reviewees can read PDF sources only if `resource.data.isPublicToReviewees == true`.
- **Exam Results**:
  - Reviewees can read and write only their own results where `resource.data.userId == request.auth.uid`.
  - Admins can read all exam results for roster monitoring and analytics.
- **Audit Logs**:
  - Only administrators can read or create `/auditLogs/{logId}`.

## 2. The Dirty Dozen Payloads (Targeting Vulnerabilities)
1. **Malicious Reviewee Self-Elevation to Admin**: Non-admin writes `role: 'admin'` into their own `/users/{uid}` profile, or creates `/admins/{attackerUid}`. -> REJECTED (Permission Denied).
2. **Reviewee Modifying Questions**: Non-admin attempts to edit `/questions/math-001` to alter the official answer. -> REJECTED.
3. **Reviewee Injecting Unpublished Questions**: Non-admin tries to read `/questions/hidden-001` where `isPublished: false`. -> REJECTED.
4. **Result Spoofing for Another User**: Attacker sets `userId: 'victim-uid'` on a high-scoring `/examResults/{resId}` submission. -> REJECTED.
5. **Exam Result Tampering by Stranger**: Attacker updates another user's exam result to fail them. -> REJECTED.
6. **Audit Log Forgery by Reviewee**: Non-admin inserts a fake audit log into `/auditLogs/log-fake`. -> REJECTED.
7. **Junk Path ID Poisoning**: Attacker requests a document ID with 2KB special characters `/questions/{corruptId}`. -> REJECTED by `isValidId`.
8. **Unverified Email Impersonation**: Attacker signs in with email `engineeringfiles05@gmail.com` with `email_verified: false` to claim admin rights. -> REJECTED.
9. **Blanket Query Scraping**: Unauthenticated attacker attempts to list all users or exam submissions. -> REJECTED.
10. **Shadow Field Injection**: Attacker submits an exam result containing arbitrary unauthorized executable fields. -> REJECTED.
11. **PDF Questionnaire Leak**: Non-admin queries unpublished private PDF sources `/pdfSources/draft-exam`. -> REJECTED.
12. **Anonymous Write Access**: Unauthenticated visitor attempts to write to `/users/visitor1`. -> REJECTED.

## Deploying the rules
`firestore.rules` only protects data once it is published. `firebase.json` and `.firebaserc` point the Firebase CLI at the app's project and its named database (`ai-studio-nexoraacademy-…`, not `(default)`). With the Firebase CLI installed (`npm install -g firebase-tools`) and signed in (`firebase login`) as the project owner:

```bash
npm run deploy:rules
```

This runs `firebase deploy --only firestore:rules` and publishes nothing else.
