# Nexora Academy Security Specification

## 1. Data Invariants
- **Identity & Access**:
  - `isAdmin()` checks whether the requester's UID exists in `/admins/{uid}` or their verified email matches the bootstrapped administrator `engineeringfiles05@gmail.com`.
  - Non-admins can only read and write their own `/users/{userId}` profile, where `{userId} == request.auth.uid`.
  - Reviewees can never write or alter documents in `/admins/{userId}`.
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
1. **Malicious Reviewee Self-Elevation to Admin**: Non-admin attempts to create a document in `/admins/{attackerUid}`. -> REJECTED (Permission Denied).
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
