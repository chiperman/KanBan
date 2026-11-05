/** 系统级时间端口；业务逻辑通过注入时钟保持可预测。 */
export interface Clock {
  now(): Date;
}
