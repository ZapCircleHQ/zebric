# Contributing to ZapCircle Zebric

Thank you for your interest in contributing to Zebric! We welcome contributions from the community.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/zebric.git
   cd zebric
   ```
3. **Install dependencies**:
   ```bash
   pnpm install
   ```
4. **Build the project**:
   ```bash
   pnpm build
   ```
5. **Run tests**:
   ```bash
   pnpm test
   ```

## Development Workflow

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes** and commit them:
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

3. **Run tests** to ensure everything works:
   ```bash
   pnpm test
   pnpm build
   ```

4. **Push your changes**:
   ```bash
   git push origin feature/my-new-feature
   ```

5. **Open a Pull Request** on GitHub

## Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Adding or updating tests
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `chore:` - Maintenance tasks

Examples:
```
feat: add PostgreSQL connection pooling
fix: resolve hot reload race condition
docs: update routing documentation
test: add unit tests for query executor
```

## Code Style

- Use **TypeScript** for all new code
- Follow existing code formatting (we use Prettier)
- Add **JSDoc comments** for public APIs
- Write **tests** for new features
- Keep functions **small and focused**

## Testing

- Write tests for all new features
- Ensure existing tests pass: `pnpm test`
- Aim for >80% code coverage
- Include integration tests for major features

## Documentation

- Update relevant documentation in `/docs` for new features
- Add examples to demonstrate usage
- Update README.md if adding major features
- Include inline code comments for complex logic

## Pull Request Process

1. **Update documentation** if needed
2. **Add tests** for new functionality
3. **Ensure all tests pass** locally
4. **Update CHANGELOG.md** with your changes
5. **Request review** from maintainers
6. **Address feedback** promptly

## What We're Looking For

### High Priority
- Bug fixes
- Performance improvements
- Test coverage improvements
- Documentation improvements
- Security fixes

### Medium Priority
- New features (discuss in an issue first)
- Database adapter improvements
- Plugin system enhancements
- Developer experience improvements

### Please Discuss First
- Major architectural changes
- Breaking changes
- New dependencies
- Changes to Blueprint specification

## Code of Conduct

### Our Standards

- Be respectful and inclusive
- Welcome newcomers
- Accept constructive criticism
- Focus on what's best for the project
- Show empathy towards others

### Unacceptable Behavior

- Harassment or discriminatory language
- Personal attacks
- Spam or off-topic comments
- Publishing private information
- Other unprofessional conduct

## Questions?

- Open an issue for bug reports or feature requests
- Join our Discord (coming soon)
- Email: jlinwood@gmail.com

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for helping make Zebric better! 🚀
