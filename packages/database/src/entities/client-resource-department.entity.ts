import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ClientResourceSnapshot } from './client-resource-snapshot.entity.js';

@Entity('client_resource_departments')
@Index('IDX_res_dept', ['resourceId', 'departmentCode'])
export class ClientResourceDepartment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier' })
  resourceId!: string;

  @Column({ type: 'nvarchar', length: 100 })
  departmentCode!: string;

  @Column({ type: 'nvarchar', length: 250 })
  departmentName!: string;

  @ManyToOne(() => ClientResourceSnapshot, (r) => r.departments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'resourceId' })
  resource!: ClientResourceSnapshot;
}
