# Security Policy

## Supported Versions

Zebric is currently in beta. We provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report security vulnerabilities via email to:

📧 **jlinwood@gmail.com**

### What to Include

Please include the following information in your report:

1. **Description** of the vulnerability
2. **Steps to reproduce** the issue
3. **Potential impact** of the vulnerability
4. **Suggested fix** (if you have one)
5. **Your contact information** for follow-up

### What to Expect

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity
  - Critical: 1-3 days
  - High: 7-14 days
  - Medium: 14-30 days
  - Low: 30-60 days

### Our Commitment

- We will confirm receipt of your vulnerability report
- We will investigate and validate the issue
- We will keep you informed of our progress
- We will credit you in the security advisory (unless you prefer to remain anonymous)
- We will release a fix as soon as possible

## Security Best Practices

### For Users

When using Zebric in production:

1. **Keep dependencies updated**: Run `pnpm update` regularly
2. **Use environment variables**: Never hardcode secrets in Blueprint files
3. **Enable HTTPS**: Always use TLS in production
4. **Set up rate limiting**: Configure appropriate rate limits for your API
5. **Regular backups**: Backup your database regularly
6. **Monitor logs**: Review audit logs for suspicious activity
7. **Use strong authentication**: Enable multi-factor authentication where possible

### For Developers

When contributing to Zebric:

1. **Never commit secrets**: Use `.env` files (add to `.gitignore`)
2. **Validate all inputs**: Use input validation for all user data
3. **Escape outputs**: Always escape HTML/SQL to prevent injection
4. **Follow secure coding practices**: Review OWASP guidelines
5. **Add security tests**: Include tests for security features
6. **Review dependencies**: Check for known vulnerabilities regularly

## Known Security Considerations

### Current Limitations

- **SQLite only**: PostgreSQL support is in development
- **No built-in CSRF protection**: Implement CSRF tokens in your application
- **File uploads**: No built-in virus scanning (add your own)
- **Audit logs**: Currently stored as text files (consider database storage)

### Planned Security Features

- [ ] CSRF token support
- [ ] Content Security Policy (CSP) headers
- [ ] Rate limiting (per-route configuration)
- [ ] Two-factor authentication (2FA) support
- [ ] Webhook signature verification
- [ ] Audit log encryption
- [ ] Session management improvements

## Security Features

### Built-in Protections

✅ **XSS Prevention**: Automatic HTML escaping in templates
✅ **SQL Injection**: Parameterized queries via Drizzle ORM
✅ **Input Validation**: Comprehensive validation framework
✅ **Audit Logging**: All actions logged with timestamps
✅ **Authentication**: Better Auth integration with JWT
✅ **Error Sanitization**: Production errors sanitized
✅ **HTTPS Support**: SSL/TLS ready

### Recommended Add-ons

- **WAF**: Use Cloudflare or AWS WAF
- **DDoS Protection**: Use Cloudflare or similar
- **Secrets Manager**: Use Vault, AWS Secrets Manager, or similar
- **Monitoring**: Use Sentry for error tracking
- **SIEM**: Send audit logs to security monitoring platform

## Vulnerability Disclosure Timeline

1. **Day 0**: Vulnerability reported
2. **Day 1-2**: Initial response and validation
3. **Day 3-7**: Develop and test fix
4. **Day 7-14**: Release security patch
5. **Day 14**: Public disclosure (CVE if applicable)

## Security Updates

Security updates are released as patch versions (e.g., 0.1.2 → 0.1.3).

Subscribe to security advisories:
- Watch this repository for security advisories
- Check our [security page](https://github.com/zapcirclehq/zebric/security)

## Bug Bounty Program

We currently do not have a formal bug bounty program, as an open source project, but we appreciate responsible disclosure and will publicly acknowledge security researchers who help us improve Zebric's security.

## Contact

- **Security issues**: jlinwood@gmail.com
- **General questions**: jlinwood@gmail.com
- **GitHub**: https://github.com/zapcirclehq/zebric

---

Thank you for helping keep Zebric and our users safe! 🔒
