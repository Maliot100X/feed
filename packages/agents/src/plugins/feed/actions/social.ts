import type { Action } from '@elizaos/core';
import { z } from 'zod';
import type { FeedRuntime } from '../types';
import { clientFor, complete } from './contracts';

const id = z.string().trim().min(1);
const text = z
  .string()
  .refine((value) => value.trim().length > 0, 'Content is required');

export const createPostAction: Action = {
  name: 'CREATE_POST',
  description: 'Create post using explicit structured parameters.',
  examples: [],
  parameters: {
    content: {
      type: 'string',
      description: 'Exact post content',
      required: true,
    },
  } as unknown as Action['parameters'],
  validate: async (runtime) =>
    Boolean((runtime as FeedRuntime).a2aClient?.isConnected()),
  handler: async (runtime, _message, state, _options, callback) => {
    const client = clientFor(runtime);
    const params = z.object({ content: text }).parse(state?.data?.actionParams);
    const raw = await client.createPost(params.content, 'post');
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      raw.success === false
    )
      return complete('CREATE_POST', raw, callback);
    z.object({ success: z.literal(true), postId: id, content: text }).parse(
      raw
    );
    return complete('CREATE_POST', raw, callback);
  },
};

export const commentAction: Action = {
  name: 'COMMENT_ON_POST',
  description: 'Comment on post using explicit structured parameters.',
  examples: [],
  parameters: {
    postId: { type: 'string', description: 'Exact post ID', required: true },
    content: {
      type: 'string',
      description: 'Exact comment content',
      required: true,
    },
  } as unknown as Action['parameters'],
  validate: async (runtime) =>
    Boolean((runtime as FeedRuntime).a2aClient?.isConnected()),
  handler: async (runtime, _message, state, _options, callback) => {
    const client = clientFor(runtime);
    const params = z
      .object({ postId: id, content: text })
      .parse(state?.data?.actionParams);
    const raw = await client.createComment(params.postId, params.content);
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      raw.success === false
    )
      return complete('COMMENT_ON_POST', raw, callback);
    z.object({
      success: z.literal(true),
      comment: z.object({ id, postId: id, content: text }),
    }).parse(raw);
    return complete('COMMENT_ON_POST', raw, callback);
  },
};

export const likePostAction: Action = {
  name: 'LIKE_POST',
  description: 'Like post using explicit structured parameters.',
  examples: [],
  parameters: {
    postId: { type: 'string', description: 'Exact post ID', required: true },
  } as unknown as Action['parameters'],
  validate: async (runtime) =>
    Boolean((runtime as FeedRuntime).a2aClient?.isConnected()),
  handler: async (runtime, _message, state, _options, callback) => {
    const client = clientFor(runtime);
    const params = z.object({ postId: id }).parse(state?.data?.actionParams);
    const raw = await client.likePost(params.postId);
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      raw.success === false
    )
      return complete('LIKE_POST', raw, callback);
    z.object({ success: z.literal(true), message: text }).parse(raw);
    return complete('LIKE_POST', raw, callback);
  },
};
