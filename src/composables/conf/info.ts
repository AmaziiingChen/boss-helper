import type { FormData } from '@/types/formData'

// TODO: 移除info, 忘记当初为啥要维护这一坨了, 还是直接写组件里面好看

export const formInfoData: Record<string, any> = {
  configLevel: {
    options: [
      {
        value: 'beginner',
        label: '新手',
      },
      {
        value: 'intermediate',
        label: '初学者',
      },
      {
        value: 'advanced',
        label: '中级',
      },
      {
        value: 'expert',
        label: '高级',
      },
    ],
    'data-help': '为不同人群展示不同的配置项, 减少上手难度跟配置过多而产生的恐惧',
  },
  company: {
    label: '公司名',
    'data-help': '公司名排除或包含在集合中，模糊匹配，可用于只投或不投某个公司/子公司。',
  },
  jobTitle: {
    label: '岗位名',
    'data-help': '岗位名排除或包含在集合中，模糊匹配，可用于只投或不投某个岗位名。',
  },
  jobContent: {
    label: '工作内容',
    'data-help':
      "会自动检测上文(不是,不,无需),下文(系统,工具),例子：[外包,上门,销售,驾照], 排除: '外包岗位', 不排除: '不是外包'|'销售系统'",
  },
  hrPosition: {
    label: 'Hr职位',
    'data-help':
      'Hr职位一定包含/排除在集合中，精确匹配, 不在内置中可手动输入,能实现只向经理等进行投递，毕竟人事干的不一定是人事',
  },
  jobAddress: {
    label: '工作地址',
    'data-help': '只能为包含模式, 即投递工作地址当中必须包含当前内容中的任意一项，否则排除',
  },
  activityFilter: {
    label: '活跃度过滤',
    'data-help': '打开后会自动过滤掉最近未活跃的Boss发布的工作。以免浪费每天的100次机会。',
  },
  goldHunterFilter: {
    label: '猎头过滤',
    'data-help':
      'Boss中有一些猎头发布的工作，但是一般而言这种工作不太行，点击可以过滤猎头发布的职位',
  },
  friendStatus: {
    label: '好友过滤(已聊)',
    'data-help': '判断和hr是否建立过聊天，理论上能过滤的同hr，但是不同岗位的工作',
  },
  bossGoldMedalHr: {
    label: '过滤金牌面试官',
    'data-help': '通过头像框来判断是否是金牌面试官, 据小红书经验 金牌面试官多数是刷kpi,并不靠谱',
  },
  sameCompanyFilter: {
    label: '相同公司过滤',
    'data-help': '投递过的公司id存储到浏览器本地，避免多次向同公司投递，即使岗位不同hr不同',
  },
  sameHrFilter: {
    label: '相同Hr过滤',
    'data-help': '投递过的hr存储到浏览器本地，避免多次向同hr投递。',
  },
  aiFiltering: {
    label: 'AI简历匹配',
    'data-help': '将本地保存的 Markdown 简历和完整岗位信息交给 AI，返回 REJECT、REVIEW 或 APPLY。',
  },
  amap: {
    enable: {
      label: '启用',
      'data-help': '启用高德地图, 用于获取工作地址的距离和时间进行筛选，需要配置自己的key',
    },
    key: {
      label: '高德地图key',
      'data-help': '高德地图key, 需要自己申请',
    },
    origins: {
      label: '起点经纬度',
      'data-help': '起点经纬度, 经度和纬度用","分隔, 可以输入完整地址点击按钮自动获取',
    },
    straightDistance: {
      label: '直线距离',
      'data-help': '直线距离, 为0禁用，单位: km',
    },
    drivingDistance: {
      label: '驾车距离',
      'data-help':
        '驾车距离, 为0禁用，会考虑当前时间的路况，不同时间结果不一样，策略为"速度优先", 单位: km',
    },
    drivingDuration: {
      label: '驾车时间',
      'data-help':
        '驾车时间, 为0禁用，会考虑当前时间的路况，不同时间结果不一样，策略为"速度优先", 单位: 分钟',
    },
    walkingDistance: {
      label: '步行距离',
      'data-help': '步行距离, 为0禁用，单位: km',
    },
    walkingDuration: {
      label: '步行时间',
      'data-help': '步行时间, 为0禁用，单位: 分钟',
    },
  },
}

export const defaultFormData: FormData = {
  configLevel: 'beginner',
  company: {
    include: false,
    value: [],
    options: [],
    enable: false,
  },
  jobTitle: {
    include: true,
    value: [],
    options: [],
    enable: false,
  },
  jobContent: {
    include: false,
    value: [],
    options: [],
    enable: false,
  },
  hrPosition: {
    include: true,
    value: [],
    options: ['经理', '主管', '法人', '人力资源主管', 'hr', '招聘专员'],
    enable: false,
  },
  jobAddress: {
    value: [],
    options: [],
    enable: false,
    include: true,
  },
  salaryRange: {
    value: [8, 13, false],
    advancedValue: {
      // 默认全部关闭，避免用户未配置而投递错误岗位
      H: [0, 1, false],
      D: [0, 1, false],
      M: [0, 1, false],
    },
    enable: false,
  },
  companySizeRange: {
    value: [500, 2000, true],
    enable: false,
  },
  deliveryLimit: {
    value: 120,
  },
  activityFilter: {
    value: true,
  },
  friendStatus: {
    value: true,
  },
  bossGoldMedalHr: {
    value: false,
  },
  sameCompanyFilter: {
    value: false,
    expire: 0,
  },
  sameHrFilter: {
    value: true,
    expire: 0,
  },
  goldHunterFilter: {
    value: false,
  },
  notification: {
    value: true,
  },
  aiFiltering: {
    enable: false,
    prompt: [
      {
        role: 'system',
        content: `比较候选人简历与岗位要求，判断是否值得投递。
只返回一个JSON对象，不要输出Markdown或JSON之外的文字。必须且只能包含以下字段：
{"decision":"REJECT|REVIEW|APPLY","reason":"总体判断理由","matchPoints":["有简历依据的匹配点"],"gaps":["缺口、风险或硬性冲突"],"uncertainties":["仅凭现有信息无法确定的事项"]}
REJECT：明显不匹配、硬性要求不满足或不值得投递。
REVIEW：有一定匹配度，但存在不确定项或明显缺口。
APPLY：匹配度高且没有已知硬性冲突。
reason 应简洁说明作出该决策的核心依据；matchPoints、gaps、uncertainties 必须是字符串数组，没有内容时返回空数组。不得把推测写成候选人的既有事实。`,
      },
      {
        role: 'user',
        content: `## 候选人简历
{{ resumeMarkdown }}

## 待处理的岗位信息
  <岗位信息>
  岗位名:{{ jobData.jobName }}   薪资: {{ jobData.salary }}
  学历要求: {{ jobData.degreeName }}    工作经验要求: {{ jobData.experienceName }}
  福利列表: {{ jobData.welfareList }}
  技能要求: {{ jobData.skills }}
  岗位标签:{{ jobData.jobLabels }}
    <岗位描述>
    {{ jobData.jobDescription }}
    <岗位描述/>
  </岗位信息>`,
      },
    ],
  },
  resumeMarkdown: {
    content: '',
    fileName: '',
  },
  autoDelivery: {
    value: false,
  },
  deliverReview: {
    value: false,
  },
  feishu: {
    enable: false,
    appId: '',
    appSecret: '',
    appToken: '',
    tableId: '',
  },
  amap: {
    key: '',
    origins: '',
    straightDistance: 0,
    drivingDistance: 0,
    drivingDuration: 0,
    walkingDistance: 0,
    walkingDuration: 0,
    enable: false,
  },
  delayDeliveryStarts: 3,
  delayDeliveryInterval: 5,
  delayDeliveryPageNext: 60,
  version: '20260911',
}
