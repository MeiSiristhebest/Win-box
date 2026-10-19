import { useState } from 'react';
import { AppModal } from '../components/AppDialog';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { applyTheme, useTheme } from '../lib/theme';
import { themes, type Theme } from '../lib/themeTokens';
import styles from './ComponentShowcasePage.module.css';

export default function ComponentShowcasePage() {
  const theme = useTheme();
  const [modalOpen, setModalOpen] = useState(false);
  const [value, setValue] = useState('');

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>开发工具</p>
          <h1>组件展示</h1>
          <p className={styles.description}>检查主题令牌、控件状态、表单反馈和弹窗。</p>
        </div>
        <label className={styles.themePicker}>
          <span>主题</span>
          <select aria-label="展示主题" value={theme} onChange={(event) => applyTheme(event.target.value as Theme)}>
            {Object.entries(themes).map(([id, definition]) => (
              <option key={id} value={id}>{definition.label}</option>
            ))}
          </select>
        </label>
      </header>

      <div className={styles.grid}>
        <Card title="按钮">
          <div className={styles.row}>
            <Button variant="primary">主要操作</Button>
            <Button variant="secondary">次要操作</Button>
            <Button variant="danger">危险操作</Button>
            <Button variant="quiet">轻量操作</Button>
          </div>
          <div className={styles.row}>
            <Button variant="primary" loading>处理中</Button>
            <Button disabled>不可用</Button>
            <Button onClick={() => setModalOpen(true)}>打开弹窗</Button>
          </div>
        </Card>

        <Card title="字段">
          <div className={styles.fields}>
            <Field
              label="订阅名称"
              hint="该名称只在本机显示。"
              placeholder="输入名称"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <Field
              label="无效示例"
              value=""
              readOnly
              error="请输入有效名称。"
            />
          </div>
        </Card>

        <Card title="选中与禁用状态">
          <label className={styles.checkRow}>
            <input type="checkbox" defaultChecked />
            <span>启用自动刷新</span>
          </label>
          <label className={styles.checkRow}>
            <input type="checkbox" disabled />
            <span>不可用的选项</span>
          </label>
          <output className={styles.status} aria-live="polite">当前主题：{theme}</output>
        </Card>

        <Card title="长文本与令牌">
          <p className={styles.longText}>
            这段文字用于检查长标题、次级说明、行间距和主题对比度。切换主题后，卡片、文字、边框、输入框和操作按钮都应使用同一份语义令牌。
          </p>
          <dl className={styles.tokens}>
            {Object.entries(themes[theme].tokens).map(([name, color]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd><code>{color}</code></dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <AppModal
        open={modalOpen}
        titleId="showcase-modal-title"
        descriptionId="showcase-modal-description"
        closeOnBackdrop
        onClose={() => setModalOpen(false)}
      >
        <div className="app-dialog-heading">
          <h2 id="showcase-modal-title">主题弹窗</h2>
        </div>
        <p className="app-dialog-message" id="showcase-modal-description">此弹窗继承当前主题，并使用浏览器的模态焦点行为。</p>
        <div className={`${styles.actions} app-dialog-actions`}>
          <Button onClick={() => setModalOpen(false)}>关闭</Button>
        </div>
      </AppModal>
    </main>
  );
}
