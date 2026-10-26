import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';

const adapter: ChatModelAdapter = {
  async *run() {
    yield { content: [{ type: 'text', text: 'ok' }] };
  },
};

const AssistantHarness = () => {
  const runtime = useLocalRuntime(adapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div>assistant ready</div>
    </AssistantRuntimeProvider>
  );
};

it('mounts the local assistant runtime without crashing', () => {
  render(<AssistantHarness />);

  expect(screen.getByText('assistant ready')).toBeTruthy();
});
