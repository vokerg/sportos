export type MainTabs = {
  Home: undefined;
  Daily: undefined;
  Activities: undefined;
  RunLab: undefined;
  More: undefined;
};

export type RootStack = {
  Main: undefined;
  About: undefined;
  RouteMap: { activityId: string };
  Heatmap: undefined;
  PerformanceDetail: {eventId:string};
  Analytics: undefined;
  ActivityDetail: { activityId: string };
  DailyDetail: { date: string };
};
