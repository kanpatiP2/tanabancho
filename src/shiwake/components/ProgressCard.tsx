export interface ProgressStep {
  text: string;
  tone: 'active' | 'done' | 'error' | 'idle';
}

export function ProgressCard({ percent, steps }: { percent: number; steps: ProgressStep[] }) {
  return (
    <div class="sw-progress">
      <div class="sw-progress-title">📋 読み取り中</div>
      <div class="sw-progress-track">
        <div class="sw-progress-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <div class="sw-stack" style={{ gap: '4px' }}>
        {steps.map((s, i) => (
          <div class="sw-step" data-tone={s.tone} key={i}>
            {s.text}
          </div>
        ))}
      </div>
    </div>
  );
}
