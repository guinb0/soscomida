import { Injectable } from '@nestjs/common';
import type { PublishedEvent } from './outbox.service';

export type EventHandler = (event: PublishedEvent) => Promise<void>;

/**
 * Registro de consumidores de eventos de domínio. Cada módulo registra seus
 * handlers no `onModuleInit`; o worker despacha por `type`.
 *
 * Handlers precisam ser idempotentes: a entrega é "pelo menos uma vez".
 */
@Injectable()
export class EventHandlerRegistry {
  private readonly handlers = new Map<string, EventHandler[]>();

  on(type: string, handler: EventHandler): void {
    const lista = this.handlers.get(type) ?? [];
    lista.push(handler);
    this.handlers.set(type, lista);
  }

  handlersFor(type: string): EventHandler[] {
    return this.handlers.get(type) ?? [];
  }

  async dispatch(event: PublishedEvent): Promise<void> {
    for (const handler of this.handlersFor(event.type)) {
      await handler(event);
    }
  }
}
