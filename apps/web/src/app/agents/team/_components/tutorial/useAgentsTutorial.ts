'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TutorialState } from '@/components/tutorial/SpotlightTutorial';
import { AGENTS_TUTORIAL_STEPS } from './steps';

const LAST_STEP = AGENTS_TUTORIAL_STEPS.length - 1;
const STORAGE_KEY = 'feed-agents-tutorial-completed';
const AUTO_START_DELAY = 500;

export type AgentsTutorialState = TutorialState;

interface UseAgentsTutorialOptions {
  onBeforeStart?: () => void;
}

export function useAgentsTutorial(
  options?: UseAgentsTutorialOptions
): AgentsTutorialState {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [hasCompleted, setHasCompleted] = useState(true);
  const onBeforeStartRef = useRef(options?.onBeforeStart);
  onBeforeStartRef.current = options?.onBeforeStart;
  const steps = AGENTS_TUTORIAL_STEPS;

  // Check localStorage on mount
  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEY) === 'true';
    setHasCompleted(completed);

    if (!completed) {
      const timer = setTimeout(() => {
        onBeforeStartRef.current?.();
        setIsActive(true);
        setCurrentStep(0);
      }, AUTO_START_DELAY);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  const finish = useCallback(() => {
    setIsActive(false);
    localStorage.setItem(STORAGE_KEY, 'true');
    setHasCompleted(true);
  }, []);

  const next = useCallback(() => {
    if (currentStep >= LAST_STEP) {
      finish();
      return;
    }
    setCurrentStep(currentStep + 1);
  }, [currentStep, finish]);

  const prev = useCallback(() => {
    setCurrentStep((p) => Math.max(0, p - 1));
  }, []);

  const restart = useCallback(() => {
    onBeforeStartRef.current?.();
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  return {
    isActive,
    currentStep,
    steps,
    hasCompleted,
    next,
    prev,
    dismiss: finish,
    complete: finish,
    restart,
  };
}
