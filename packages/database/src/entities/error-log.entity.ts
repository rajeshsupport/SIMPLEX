import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('error_logs')
export class ErrorLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @CreateDateColumn({ type: 'datetime2' })
  timestamp!: Date;

  @Index()
  @Column({ type: 'nvarchar', length: 100, nullable: true })
  correlationId?: string | null;

  @Column({ type: 'nvarchar', length: 100, default: 'API' })
  serviceName!: string;

  @Column({ type: 'nvarchar', length: 50, default: 'ERROR' })
  level!: 'ERROR' | 'FATAL' | 'WARN';

  @Column({ type: 'nvarchar', length: 'max' })
  message!: string;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  stackTrace?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  contextJson?: string | null;
}
