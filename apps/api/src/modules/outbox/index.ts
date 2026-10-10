import { Global, Module } from '@nestjs/common';
import { EventHandlerRegistry } from './event-handlers';
import { OutboxService } from './outbox.service';

export { OutboxService, type DomainEvent, type PublishedEvent } from './outbox.service';
export { EventHandlerRegistry, type EventHandler } from './event-handlers';

@Global()
@Module({ providers: [OutboxService, EventHandlerRegistry], exports: [OutboxService, EventHandlerRegistry] })
export class OutboxModule {}
