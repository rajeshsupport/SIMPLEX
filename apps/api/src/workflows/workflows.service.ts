import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutomationWorkflow, AutomationWorkflowVersion } from '@hmc/database';
import { CreateWorkflowDto } from '@hmc/shared';

@Injectable()
export class WorkflowsService {
  constructor(
    @InjectRepository(AutomationWorkflow)
    private workflowRepo: Repository<AutomationWorkflow>,
    @InjectRepository(AutomationWorkflowVersion)
    private versionRepo: Repository<AutomationWorkflowVersion>
  ) {}

  async getAllWorkflows(): Promise<AutomationWorkflow[]> {
    return this.workflowRepo.find({
      relations: ['versions'],
      order: { createdAt: 'ASC' },
    });
  }

  async getWorkflowByCode(code: string): Promise<AutomationWorkflow & { activeVersion?: AutomationWorkflowVersion }> {
    const workflow = await this.workflowRepo.findOne({
      where: { workflowCode: code },
      relations: ['versions'],
    });
    if (!workflow) throw new NotFoundException(`Workflow ${code} not found`);

    const activeVersion = workflow.versions?.find((v) => v.isActive) || workflow.versions?.[0];
    return { ...workflow, activeVersion };
  }

  async createWorkflow(dto: CreateWorkflowDto, username: string): Promise<AutomationWorkflow> {
    const existing = await this.workflowRepo.findOne({ where: { workflowCode: dto.workflowCode } });
    if (existing) throw new BadRequestException(`Workflow with code '${dto.workflowCode}' already exists`);

    const workflow = this.workflowRepo.create({
      workflowCode: dto.workflowCode,
      name: dto.name,
      description: dto.description,
      appVersion: dto.appVersion,
      createdBy: username,
      updatedBy: username,
    });
    const savedWf = await this.workflowRepo.save(workflow);

    const version = this.versionRepo.create({
      workflowId: savedWf.id,
      versionNumber: 1,
      applicableAppVersion: dto.appVersion,
      pageRoute: dto.pageRoute,
      stepsJson: JSON.stringify(dto.steps),
      successConditionsJson: JSON.stringify(dto.successConditions || []),
      errorConditionsJson: JSON.stringify(dto.errorConditions || []),
      securityBlockConditionsJson: JSON.stringify(dto.securityBlockConditions || []),
      defaultTimeoutMs: dto.defaultTimeoutMs || 30000,
      maxRetries: dto.maxRetries || 2,
      isActive: true,
      createdBy: username,
    });
    await this.versionRepo.save(version);

    return this.getWorkflowByCode(dto.workflowCode);
  }
}
