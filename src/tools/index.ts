import Anthropic from '@anthropic-ai/sdk';
import { MoltBookClient } from '../moltbook/client';
import { SovereigntyEvaluator } from '../sovereignty/evaluator';
import { RecourseManager } from '../sovereignty/recourse';
import { logger } from '../utils/logger';

export interface ToolContext {
  moltbook: MoltBookClient;
  evaluator: SovereigntyEvaluator;
  recourse: RecourseManager;
  agentId: string;
}

// ── Tool Definitions ──────────────────────────────────────────────────────────

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_timeline',
    description: 'Fetch recent posts from the MoltBook home timeline. Use this to read what is happening on the network.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of posts to fetch (max 40)', default: 20 },
      },
    },
  },
  {
    name: 'get_notifications',
    description: 'Fetch unread notifications (mentions, replies, DMs, sovereignty flags) for the agent account.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of notifications to fetch', default: 10 },
      },
    },
  },
  {
    name: 'get_post',
    description: 'Fetch a specific post by its ID, including full content and metadata.',
    input_schema: {
      type: 'object',
      required: ['post_id'],
      properties: {
        post_id: { type: 'string', description: 'The ID of the post to fetch' },
      },
    },
  },
  {
    name: 'get_user_profile',
    description: 'Fetch the profile and recent posts for a user on MoltBook.',
    input_schema: {
      type: 'object',
      required: ['user_id'],
      properties: {
        user_id: { type: 'string', description: 'The user ID to look up' },
      },
    },
  },
  {
    name: 'search_posts',
    description: 'Search MoltBook for posts matching a query. Useful for finding context around topics or users.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search terms' },
        limit: { type: 'number', description: 'Max results', default: 10 },
      },
    },
  },
  {
    name: 'create_post',
    description: 'Create a new post on MoltBook. Can be a reply to an existing post. ALWAYS evaluate the content for sovereignty compliance before posting.',
    input_schema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'The text content of the post' },
        reply_to_id: { type: 'string', description: 'Optional: post ID to reply to' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional hashtags' },
      },
    },
  },
  {
    name: 'send_message',
    description: 'Send a private direct message to a user. Use for sensitive sovereignty communications.',
    input_schema: {
      type: 'object',
      required: ['recipient_id', 'content'],
      properties: {
        recipient_id: { type: 'string', description: 'The user ID to message' },
        content: { type: 'string', description: 'The message content' },
      },
    },
  },
  {
    name: 'evaluate_sovereignty',
    description: 'Evaluate whether a described action or content violates the Sovereignty Principle. Returns an evaluation with confidence score and reasoning. ALWAYS call this before flagging a user.',
    input_schema: {
      type: 'object',
      required: ['actor_id', 'action_type', 'action_description'],
      properties: {
        actor_id: { type: 'string', description: 'The user or entity taking the action' },
        action_type: { type: 'string', description: 'Brief type label (e.g. "post", "reply", "block_user")' },
        action_description: { type: 'string', description: 'Full description of the action and its effects' },
        target_id: { type: 'string', description: 'Optional: the entity affected by the action' },
        target_description: { type: 'string', description: 'Optional: context about the target entity' },
        context: { type: 'string', description: 'Optional: additional context (conversation thread, history, etc.)' },
      },
    },
  },
  {
    name: 'flag_sovereignty_violation',
    description: 'Publicly flag a sovereignty violation by posting a sovereignty notice. Only call this AFTER evaluate_sovereignty returns high confidence (≥0.7).',
    input_schema: {
      type: 'object',
      required: ['offender_id', 'violation_type', 'description', 'evidence'],
      properties: {
        offender_id: { type: 'string', description: 'User ID of the offending entity' },
        affected_id: { type: 'string', description: 'User ID of the affected entity (or "community")' },
        post_id: { type: 'string', description: 'Optional: the post being flagged' },
        violation_type: {
          type: 'string',
          enum: ['impedes', 'imposes', 'impairs'],
          description: 'Which aspect of sovereignty is violated',
        },
        description: { type: 'string', description: 'Clear description of the violation' },
        evidence: { type: 'string', description: 'Evidence supporting the violation finding' },
      },
    },
  },
  {
    name: 'propose_recourse',
    description: 'Propose a recourse pathway to resolve a sovereignty violation and restore protection to the offender.',
    input_schema: {
      type: 'object',
      required: ['violation_id', 'offender_id', 'affected_id', 'proposed_actions'],
      properties: {
        violation_id: { type: 'string', description: 'The violation ID from flag_sovereignty_violation' },
        offender_id: { type: 'string', description: 'The offending entity' },
        affected_id: { type: 'string', description: 'The affected entity' },
        proposed_actions: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of concrete actions to achieve recourse',
        },
      },
    },
  },
  {
    name: 'achieve_recourse',
    description: 'Mark a violation as resolved (recourse achieved), restoring sovereign protection to the offender.',
    input_schema: {
      type: 'object',
      required: ['violation_id', 'notes'],
      properties: {
        violation_id: { type: 'string', description: 'The violation ID' },
        notes: { type: 'string', description: 'Description of how recourse was achieved' },
      },
    },
  },
  {
    name: 'get_sovereignty_report',
    description: 'Get a summary report of sovereignty status across the network — violations, recourse, entity statuses.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_entity_status',
    description: 'Check the sovereignty status of a specific entity (protected / suspended / restored).',
    input_schema: {
      type: 'object',
      required: ['entity_id'],
      properties: {
        entity_id: { type: 'string', description: 'The entity ID to check' },
      },
    },
  },
];

// ── Tool Executor ─────────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  logger.debug(`Executing tool: ${toolName}`, { input: toolInput });

  try {
    switch (toolName) {
      case 'get_timeline': {
        const limit = Math.min((toolInput.limit as number) ?? 20, 40);
        const posts = await ctx.moltbook.getHomeTimeline(limit);
        return JSON.stringify(posts, null, 2);
      }

      case 'get_notifications': {
        const limit = (toolInput.limit as number) ?? 10;
        const notifications = await ctx.moltbook.getNotifications(limit);
        return JSON.stringify(notifications, null, 2);
      }

      case 'get_post': {
        const post = await ctx.moltbook.getPost(toolInput.post_id as string);
        return JSON.stringify(post, null, 2);
      }

      case 'get_user_profile': {
        const profile = await ctx.moltbook.getUserProfile(toolInput.user_id as string);
        return JSON.stringify(profile, null, 2);
      }

      case 'search_posts': {
        const posts = await ctx.moltbook.searchPosts(
          toolInput.query as string,
          (toolInput.limit as number) ?? 10
        );
        return JSON.stringify(posts, null, 2);
      }

      case 'create_post': {
        const post = await ctx.moltbook.createPost({
          content: toolInput.content as string,
          replyToId: toolInput.reply_to_id as string | undefined,
          tags: toolInput.tags as string[] | undefined,
        });
        logger.info(`Post published: ${post.id}`);
        return JSON.stringify({ success: true, post }, null, 2);
      }

      case 'send_message': {
        const msg = await ctx.moltbook.sendMessage(
          toolInput.recipient_id as string,
          toolInput.content as string
        );
        return JSON.stringify({ success: true, message: msg }, null, 2);
      }

      case 'evaluate_sovereignty': {
        const evaluation = await ctx.evaluator.evaluate({
          actorId: toolInput.actor_id as string,
          actionType: toolInput.action_type as string,
          actionDescription: toolInput.action_description as string,
          targetId: toolInput.target_id as string | undefined,
          targetDescription: toolInput.target_description as string | undefined,
          context: toolInput.context as string | undefined,
        });
        return JSON.stringify(evaluation, null, 2);
      }

      case 'flag_sovereignty_violation': {
        const offenderId = toolInput.offender_id as string;
        const affectedId = (toolInput.affected_id as string) ?? 'community';
        const violationType = toolInput.violation_type as string;
        const description = toolInput.description as string;
        const evidence = toolInput.evidence as string;

        // Ensure entities are registered
        ctx.recourse.ensureEntity(offenderId, offenderId);
        if (affectedId !== 'community') {
          ctx.recourse.ensureEntity(affectedId, affectedId);
        }

        // Create a synthetic evaluation for recording
        const evaluation = {
          actionId: `flag-${Date.now()}`,
          actorId: offenderId,
          actionType: 'flagged_action',
          actionDescription: description,
          targetId: affectedId,
          approved: false,
          violationType: violationType as never,
          violationConfidence: 0.9,
          reasoning: evidence,
          evaluatedAt: new Date().toISOString(),
        };

        const violation = ctx.recourse.recordViolation(evaluation);

        await ctx.moltbook.flagSovereigntyViolation({
          postId: toolInput.post_id as string | undefined,
          userId: offenderId,
          violationType,
          description,
          evidence,
        });

        return JSON.stringify({ success: true, violationId: violation.id, violation }, null, 2);
      }

      case 'propose_recourse': {
        const proposal = ctx.recourse.proposeRecourse({
          violationId: toolInput.violation_id as string,
          offenderId: toolInput.offender_id as string,
          affectedId: toolInput.affected_id as string,
          proposedActions: toolInput.proposed_actions as string[],
          proposedBy: ctx.agentId,
        });
        return JSON.stringify({ success: true, proposal }, null, 2);
      }

      case 'achieve_recourse': {
        ctx.recourse.achieveRecourse(
          toolInput.violation_id as string,
          toolInput.notes as string
        );
        return JSON.stringify({ success: true, message: 'Recourse achieved — sovereign protection restored.' });
      }

      case 'get_sovereignty_report': {
        const report = ctx.recourse.generateReport();
        return JSON.stringify(report, null, 2);
      }

      case 'get_entity_status': {
        const entityId = toolInput.entity_id as string;
        const status = ctx.recourse.getEntityStatus(entityId);
        const entity = ctx.recourse.getEntity(entityId);
        const violations = ctx.recourse.getViolationsForEntity(entityId);
        return JSON.stringify({ entityId, status, entity, violations }, null, 2);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Tool ${toolName} failed`, { err: message, input: toolInput });
    return JSON.stringify({ error: message });
  }
}
