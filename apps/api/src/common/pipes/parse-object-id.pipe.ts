import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { isObjectIdString, normalizeObjectId } from '../mongo/object-id';

/**
 * Validates a route parameter as a MongoDB ObjectId and returns it in
 * canonical lowercase hex form. Rejecting malformed ids here keeps them from
 * reaching Mongoose as CastErrors (which would surface as 500s).
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isObjectIdString(value)) {
      throw new BadRequestException('Invalid id');
    }
    return normalizeObjectId(value);
  }
}
