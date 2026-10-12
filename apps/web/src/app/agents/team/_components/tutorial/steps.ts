import type { TutorialStep } from '@/components/tutorial/SpotlightTutorial';

export type { TutorialStep };

/**
 * Steps target elements rendered by the team page chat view on every
 * viewport. SpotlightTutorial skips a step whose target never appears
 * (e.g. the add button is hidden once the party is full).
 */
export const AGENTS_TUTORIAL_STEPS: TutorialStep[] = [
  {
    target: '[data-tour="agents-member-list"]',
    title: 'Your Agent Team',
    description:
      'This is your team of AI agents. Each agent has its own personality, wallet, and trading strategy. Select an agent to see its stats and settings.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="agents-add-button"]',
    title: 'Recruit Agents',
    description:
      'Open the roster to pick archetypes and deploy new agents to your team.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="agents-chat-area"]',
    title: 'Team Chat',
    description:
      'Chat with your agents here. Use @mentions to direct specific agents. They share market insights, execute trades, and attach quick-action tags to their messages.',
    placement: 'top',
  },
];
