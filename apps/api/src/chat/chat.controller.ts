import { Body, Controller, Inject, Post } from '@nestjs/common';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { ChatService } from './chat.service.js';
import { parseChatRequest } from './chat.contracts.js';
@Controller('chat')
export class ChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}
  @Post('answers')
  answer(@Body() body: unknown, @CurrentAccount() account: AuthenticatedAccount) {
    return this.chat.answer(parseChatRequest(body), account.id);
  }
}
