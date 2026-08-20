'use strict';

const fs = require('fs');
const path = require('path');

const FRONT_MATTER = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;
const BLOCK_SCALAR = /^[|>][+-]?$/;

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function parseFrontMatter(source) {
  const match = source.match(FRONT_MATTER);
  if (!match) return null;

  const lines = match[1].split(/\r?\n/);
  const fields = {};

  for (let i = 0; i < lines.length; i++) {
    const field = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!field) continue;

    const key = field[1];
    let value = field[2].trim();

    if (BLOCK_SCALAR.test(value)) {
      // 块标量（> 折叠 / | 保留换行）：收集后续缩进行作为多行描述
      const literal = value[0] === '|';
      const collected = [];
      while (i + 1 < lines.length && (lines[i + 1] === '' || /^\s+\S/.test(lines[i + 1]))) {
        collected.push(lines[++i].trim());
      }
      value = collected.join(literal ? '\n' : ' ').trim();
    } else if ((value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
               (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
      value = value.slice(1, -1);
    }

    fields[key] = value;
  }

  if (!fields.name || !fields.description) return null;
  return {
    name: fields.name,
    description: fields.description
  };
}

function scanRoot(root) {
  let entries;

  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const source = readTextSafe(path.join(root, entry.name, 'SKILL.md'));
      const metadata = source ? parseFrontMatter(source) : null;
      return metadata ? { ...metadata, slug: entry.name } : null;
    })
    .filter(Boolean);
}

// README.md 是对外的说明文章（与 SKILL.md 分离）；两个目录任有其一直读即可
function readSkillReadme(roots, slug) {
  for (const root of roots) {
    const source = readTextSafe(path.join(root, slug, 'README.md'));
    if (source != null) return source.replace(FRONT_MATTER, '').trim();
  }
  return null;
}

function discoverSkills(roots) {
  const seen = new Set();
  const skills = [];

  // 顺序即优先级：.agents/skills 为 ZCode 实际使用的正本，source/skills 为站点保存副本
  for (const root of roots) {
    for (const skill of scanRoot(root)) {
      if (seen.has(skill.slug)) continue;
      seen.add(skill.slug);
      skills.push(skill);
    }
  }

  return skills
    .map(skill => ({ ...skill, readme: readSkillReadme(roots, skill.slug) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

hexo.extend.generator.register('skills', function() {
  const hexo = this;
  const base = hexo.base_dir;
  const roots = [
    path.join(base, '.agents', 'skills'),
    path.join(base, 'source', 'skills')
  ];
  const skills = discoverSkills(roots);

  return [
    {
      path: 'skills/index.html',
      layout: 'skills',
      data: {
        title: 'Skill-Hub',
        skills: skills.map(({ slug, name, description, readme }) => ({
          slug, name, description,
          readme: Boolean(readme)
        }))
      }
    },
    // 有 README.md 的技能生成详情页：渲染 README 说明文章（SKILL.md 正文不发布）
    ...skills.filter(skill => skill.readme).map(skill => ({
      path: `skills/${skill.slug}/index.html`,
      layout: 'skill',
      data: {
        title: skill.name,
        description: skill.description,
        content: hexo.render.renderSync({ text: skill.readme, engine: 'md' })
      }
    }))
  ];
});
