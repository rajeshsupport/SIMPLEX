import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('stored_files')
export class StoredFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 255 })
  fileName!: string;

  @Column({ type: 'nvarchar', length: 100 })
  fileType!: 'IMPORT_INPUT' | 'ERROR_REPORT' | 'SCREENSHOT' | 'AUDIT_EXPORT' | 'SYSTEM_BACKUP';

  @Column({ type: 'bigint' })
  fileSizeBytes!: number;

  @Column({ type: 'nvarchar', length: 500 })
  storagePath!: string;

  @Column({ type: 'nvarchar', length: 150, default: 'application/octet-stream' })
  mimeType!: string;

  @Index()
  @Column({ type: 'nvarchar', length: 100, nullable: true })
  importJobId?: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 100, nullable: true })
  automationRunId?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  createdBy?: string;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;
}
