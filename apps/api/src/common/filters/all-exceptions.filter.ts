import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse: any =
      exception instanceof HttpException ? exception.getResponse() : null;

    let message = 'Internal Server Error';
    let errors: any = undefined;

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (exceptionResponse && typeof exceptionResponse === 'object') {
      message = exceptionResponse.message || message;
      errors = exceptionResponse.errors;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const correlationId = request.correlationId || request.headers['x-correlation-id'] || 'n/a';

    if (status >= 500) {
      this.logger.error(
        `[${correlationId}] ${request.method} ${request.url} - Status ${status} - ${message}`,
        exception instanceof Error ? exception.stack : ''
      );
    } else {
      this.logger.warn(
        `[${correlationId}] ${request.method} ${request.url} - Status ${status} - ${message}`
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
      correlationId,
    });
  }
}
