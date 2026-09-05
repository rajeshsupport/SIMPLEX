import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ClientResourceSnapshot } from './client-resource-snapshot.entity.js';

@Entity('client_resource_services')
@Index('IDX_res_serv', ['resourceId', 'serviceCode'])
export class ClientResourceService {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier' })
  resourceId!: string;

  @Column({ type: 'nvarchar', length: 100 })
  serviceCode!: string;

  @Column({ type: 'nvarchar', length: 250 })
  serviceName!: string;

  @ManyToOne(() => ClientResourceSnapshot, (r) => r.services, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'resourceId' })
  resource!: ClientResourceSnapshot;
}
