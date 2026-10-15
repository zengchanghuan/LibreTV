"""Readable Chinese labels, retaining station call signs and unestablished brand names.

These are display translations/descriptions, not claims of official Chinese branding.
The original English title, metadata and stream address are always preserved.
"""
import re

SEPARATOR = '｜'

EXACT = {
    '00s Replay': '千禧年代金曲回放频道', '70s Cinema': '七十年代影院',
    '80s Rewind': '八十年代经典回顾', '90s Throwback': '九十年代怀旧频道',
    "90's Kids": '九十年代儿童频道', '90s Kids TV 2': '九十年代儿童第二频道',
    '3ABN Praise Him Music Network': '3ABN赞美主音乐频道',
    '3ABN Proclaim! Network': '3ABN宣讲频道',
    '3ABN Canada': '3ABN加拿大频道', '3ABN English': '3ABN英语频道',
    '3ABN International': '3ABN国际频道', '3ABN Kids': '3ABN儿童频道',
    '3ABN TV Uganda': '3ABN乌干达频道',
    'AKC TV Meet the Breeds': 'AKC犬种介绍频道', 'AKC TV Puppies': 'AKC幼犬频道',
    'AKC TV': 'AKC犬类频道', '5 Cops': '第五警务频道',
    'ABC Entertains': '澳大利亚ABC娱乐频道',
    'House of Lies': '谎言屋', 'Awkward': '囧女珍娜',
    'JAG': '执法悍将', 'Judge Judy': '朱迪法官', 'Rawhide': '皮鞭',
    'Sabrina the Teenage Witch': '魔法少女萨布丽娜',
    'The Addams Family': '亚当斯一家', 'Tiny House Nation': '小房子大梦想',
    'The Jamie Oliver Channel': '杰米·奥利弗烹饪频道',
    'The Hills': '好莱坞女孩', 'The Hills: New Beginnings': '好莱坞女孩：新篇章',
    'World Poker Tour': '世界扑克巡回赛', 'Formula 1': 'F1一级方程式赛车',
    'Sensing Murder': '通灵探案', 'SvampeBob Firkant': '海绵宝宝',
    'DanceTV Minimal Tech': 'DanceTV极简电子舞曲频道',
    'Best of MTV': 'MTV精选频道', 'In the Kitchen': '厨房美食频道',
    'EntrepreneurTV': '创业者频道', 'Fashion&LifeStyle': '时尚与生活频道',
    'Pluto TV': 'Pluto TV', 'Stingray': 'Stingray', 'Vevo': 'Vevo',
    'BBC Earth': 'BBC地球频道', 'BBC First': 'BBC精选剧集频道',
    'BBC Brit': 'BBC英伦娱乐频道', 'BBC Four': 'BBC第四台',
    'BBC One': 'BBC第一台', 'BBC Two': 'BBC第二台', 'BBC Three': 'BBC第三台',
    'BBC Parliament': 'BBC议会频道', 'BBC News': 'BBC新闻频道',
    'BBC America': 'BBC美国频道', 'BBC Food': 'BBC美食频道',
    'BBC Red Button': 'BBC红按钮互动频道', 'BBC Home & Garden': 'BBC家居园艺频道',
    'BBC Lifestyle': 'BBC生活频道', 'BBC Kids': 'BBC儿童频道',
    'CNN International': 'CNN国际新闻频道', 'CNN': '美国有线电视新闻网',
    'CNN Headlines': 'CNN头条新闻频道', 'CNN Fast': 'CNN快讯频道',
    'CGTN': '中国国际电视台英语频道', 'CGTN Documentary': '中国国际电视台纪录频道',
    'DW English': '德国之声英语频道', 'DW': '德国之声',
    'France 24 English': '法国24台英语频道', 'France 24': '法国24台',
    'Al Jazeera English': '半岛电视台英语频道', 'Al Arabiya English': '阿拉比亚英语频道',
    'NHK World Japan': '日本国际传媒频道', 'NHK World-Japan': '日本国际传媒频道',
    'NHK World': '日本国际传媒频道', 'Arirang TV': '阿里郎电视台',
    'Arirang UN': '阿里郎联合国频道', 'Bloomberg': '彭博财经频道',
    'Bloomberg Television': '彭博财经电视台', 'Bloomberg TV': '彭博财经电视台',
    'Bloomberg Originals': '彭博原创频道', 'Euronews English': '欧洲新闻台英语频道',
    'Sky News': '天空新闻台', 'Sky News Arabia': '天空新闻台阿拉伯版',
    'Sky News Australia': '澳大利亚天空新闻台', 'Sky Sports News': '天空体育新闻频道',
    'Fox News': '福克斯新闻频道', 'Fox News Channel': '福克斯新闻频道',
    'Fox Business': '福克斯商业频道', 'Fox Weather': '福克斯天气频道',
    'ABC News Live': '美国ABC新闻直播频道', 'CBS News': 'CBS新闻频道',
    'CBS Sports': 'CBS体育频道', 'NBC News': 'NBC新闻频道',
    'NBC Sports': 'NBC体育频道', 'NBC News NOW': 'NBC新闻直播频道',
    'MSNBC': '微软全国广播公司新闻频道', 'CNBC': '消费者新闻与商业频道',
    'Newsmax': 'Newsmax新闻频道', 'NewsNation': 'NewsNation新闻频道',
    'USA Today': '今日美国', 'Reuters': '路透社', 'The Guardian': '卫报',
    'The Weather Channel': '天气频道', 'WeatherNation': 'WeatherNation天气频道',
    'AccuWeather NOW': 'AccuWeather实时天气频道',
    'National Geographic': '国家地理频道', 'Nat Geo Wild': '国家地理野生频道',
    'Animal Planet': '动物星球频道', 'Discovery Channel': '探索频道',
    'Discovery Science': '探索科学频道', 'Discovery Turbo': '探索极速频道',
    'Investigation Discovery': '探索调查频道', 'Discovery': '探索频道',
    'History Channel': '历史频道', 'History': '历史频道', 'History 2': '历史第二频道',
    'Cartoon Network': '卡通频道', 'Cartoonito': '卡通幼儿频道',
    'Nickelodeon': '尼克儿童频道', 'Nick Jr.': '尼克幼儿频道',
    'Nick Jr': '尼克幼儿频道', 'Nicktoons': '尼克卡通频道',
    'Nick Teen': '尼克青少年频道', 'TeenNick': '尼克青少年频道',
    'Disney Channel': '迪士尼频道', 'Disney Junior': '迪士尼幼儿频道',
    'Disney XD': '迪士尼XD频道', 'BabyTV': '宝宝电视台',
    'BabyFirst': '宝宝第一频道', 'Baby Shark TV': '鲨鱼宝宝频道',
    'Peppa Pig': '小猪佩奇', 'SpongeBob SquarePants': '海绵宝宝',
    'SpongeBob': '海绵宝宝', 'Dora the Explorer': '爱探险的朵拉',
    'Avatar': '降世神通', 'The Smurfs': '蓝精灵', 'Paw Patrol': '汪汪队立大功',
    'South Park': '南方公园', 'South Park en Español': '南方公园西班牙语版',
    'The Simpsons': '辛普森一家', 'Family Guy': '恶搞之家',
    'American Dad': '美国老爹', 'Beavis and Butt-Head': '瘪四与大头蛋',
    'Daria': '拽妹黛薇儿', 'King of the Hill': '乡巴佬希尔一家的幸福生活',
    'The Fairly OddParents': '趣怪守护仙', 'Rugrats': '淘气小兵兵',
    'Hey Arnold!': '嘿阿诺德', 'Teenage Mutant Ninja Turtles': '忍者神龟',
    'Pokemon': '宝可梦', 'Pokémon': '宝可梦', 'Yu-Gi-Oh!': '游戏王',
    'Star Trek': '星际迷航', 'Star Trek: The Next Generation': '星际迷航：下一代',
    'Star Trek: Voyager': '星际迷航：航海家号', 'Stargate': '星际之门',
    'Battlestar Galactica': '太空堡垒卡拉狄加', 'Andromeda': '仙女座号',
    'Doctor Who': '神秘博士', 'The Walking Dead': '行尸走肉',
    'The Twilight Zone': '迷离时空', 'The Outer Limits': '外星界限',
    'CSI': '犯罪现场调查', 'CSI: Miami': '犯罪现场调查：迈阿密',
    'CSI: NY': '犯罪现场调查：纽约', 'NCIS': '海军罪案调查处',
    'Criminal Minds': '犯罪心理', 'Law & Order': '法律与秩序',
    'Law & Order: Criminal Intent': '法律与秩序：犯罪倾向',
    'Midsomer Murders': '骇人命案事件簿', 'Forensic Files': '法医档案',
    'Unsolved Mysteries': '未解之谜', 'Cold Case Files': '悬案档案',
    'True Crime': '真实犯罪', 'Dateline': '新闻专线', '48 Hours': '48小时',
    'Baywatch': '海滩救护队', 'MacGyver': '百战天龙',
    'Walker Texas Ranger': '德州巡警', 'Walker, Texas Ranger': '德州巡警',
    'The A-Team': '天龙特攻队', 'Knight Rider': '霹雳游侠',
    'Mission: Impossible': '虎胆妙算', 'Hawaii Five-0': '天堂执法者',
    '7th Heaven': '七重天', 'Little House on the Prairie': '草原小屋',
    'The Love Boat': '爱之船', 'The Beverly Hillbillies': '豪门新人类',
    'The Andy Griffith Show': '安迪·格里菲斯秀', 'I Love Lucy': '我爱露西',
    'Happy Days': '欢乐时光', 'Cheers': '干杯酒吧', 'Frasier': '欢乐一家亲',
    'Friends': '老友记', 'Seinfeld': '宋飞正传', 'Three’s Company': '三人行',
    "Three's Company": '三人行', 'Family Ties': '家族的纽带',
    'Family Matters': '家庭琐事', 'The Nanny': '天才保姆',
    'Everybody Hates Chris': '人人都恨克里斯', 'Everybody Loves Raymond': '人人都爱雷蒙德',
    'Two and a Half Men': '好汉两个半', 'Anger Management Channel': '愤怒管理频道',
    'Are We There Yet?': '小鬼上路', 'Are You The One?': '你是我的唯一',
    'America’s Next Top Model': '全美超模大赛', "America's Next Top Model": '全美超模大赛',
    "America's Test Kitchen": '美国试验厨房', 'Top Gear': '巅峰拍档',
    'Top Chef': '顶级厨师', 'MasterChef': '厨艺大师', 'Hell’s Kitchen': '地狱厨房',
    "Hell's Kitchen": '地狱厨房', 'Kitchen Nightmares': '厨房噩梦',
    'Gordon Ramsay': '戈登·拉姆齐', 'Jamie Oliver': '杰米·奥利弗',
    'Anthony Bourdain: Parts Unknown': '安东尼·波登：未知之旅',
    'Antiques Roadshow': '古董鉴赏会', 'Antiques Road Trip': '古董寻宝之旅',
    'Pawn Stars': '当铺之星', 'Storage Wars': '仓库寻宝',
    'Auction Hunters': '拍卖猎人', 'American Pickers': '美国拾荒者',
    'Ice Road Truckers': '冰路卡车司机', 'Deadliest Catch': '致命捕捞',
    'Duck Dynasty': '鸭子王朝', 'Dog the Bounty Hunter': '赏金猎人多格',
    'Fear Factor': '挑战恐惧', 'Survivor': '幸存者', 'The Amazing Race': '极速前进',
    'The Price Is Right': '价格竞猜', 'The Price is Right': '价格竞猜',
    'Wheel of Fortune': '幸运之轮', 'Jeopardy!': '危险边缘知识竞赛',
    'Family Feud': '家庭问答赛', 'Deal or No Deal': '一掷千金',
    'Takeshi’s Castle': '风云再起武士城', "Takeshi's Castle": '风云再起武士城',
    'Just for Laughs': '欢乐搞笑频道', 'FailArmy': '失败军团搞笑频道',
    'The Pet Collective': '萌宠趣事频道', 'People Are Awesome': '牛人精彩频道',
    'America’s Funniest Home Videos': '美国家庭搞笑录像',
    "America's Funniest Home Videos": '美国家庭搞笑录像',
    'AFV': '美国家庭搞笑录像', 'Bar Rescue': '拯救酒吧',
    'Jersey Shore': '泽西海岸', 'Geordie Shore': '乔迪海岸',
    'Acapulco Shore': '阿卡普尔科海岸', 'Ridiculousness': '荒唐至极',
    'Catfish: The TV Show': '鲶鱼：网络情缘', 'Catfish': '鲶鱼：网络情缘',
    'The Challenge': '挑战赛', 'Teen Mom': '少女妈妈',
    'MythBusters': '流言终结者', 'Mythbusters': '流言终结者',
    'How It’s Made': '制造的原理', "How It's Made": '制造的原理',
    'Modern Marvels': '现代奇迹', 'Ancient Aliens': '远古外星人',
    'The New Detectives': '新侦探', 'The FBI Files': '联邦调查局档案',
    'NASA TV': '美国宇航局电视台', 'NASA TV Public': '美国宇航局公共频道',
    'NASA Live': '美国宇航局直播频道', 'NASA+': '美国宇航局流媒体频道',
    'Red Bull TV': '红牛电视台', 'FIFA+': '国际足联频道',
    'Tennis Channel': '网球频道', 'Golf Channel': '高尔夫频道',
    'Eurosport': '欧洲体育频道', 'TNT Sports': 'TNT体育频道',
    'MotorTrend': '汽车趋势频道', 'Love Nature': '热爱自然频道',
    'Travel Channel': '旅游频道', 'Food Network': '美食电视网',
    'Cooking Channel': '烹饪频道', 'HGTV': '家居园艺频道',
    'Fashion TV': '时尚电视台', 'FashionTV': '时尚电视台',
    'Deutsche Welle': '德国之声', 'Russia Today': '今日俄罗斯',
}

# Country/region suffixes are descriptions of editions, never language guesses.
PHRASES = {
    'Remember the 80s': '八十年代回忆', 'Remember the 90s': '九十年代回忆',
    'Minimal Tech': '极简电子舞曲', 'Hip-Hop': '嘻哈',
    'Media Center': '媒体中心', 'United Nations': '联合国',
    'Throwback Party': '怀旧派对', 'All Day': '全天', 'Pluto TV': 'Pluto TV',
    'The Beach Show': '海滩节目', 'We Love Cars': '汽车爱好者',
    'Golf Kingdom': '高尔夫王国', 'Investment Pitch': '投资推介',
    'Luxe Life Discovered': '奢华生活探索',
    'Fantasy': '奇幻', 'Retro': '怀旧', 'Smooth': '柔情', 'Remember': '回忆',
    'Legends': '传奇', 'Legend': '传奇', 'Archives': '档案', 'Archive': '档案',
    'Adria': '亚得里亚版', 'Adriatic': '亚得里亚', 'Brit': '英伦',
    'Maldives': '马尔代夫', 'Haiti': '海地', 'Turkmenistan': '土库曼斯坦',
    'Israel': '以色列', 'Ireland': '爱尔兰', 'Irish': '爱尔兰',
    'Nashua': '纳舒厄', 'Humboldt': '洪堡', 'Tuolumne': '图奥勒米',
    'Fairfield': '费尔菲尔德', 'Collier': '科利尔', 'Gillette': '吉列',
    'Key West': '基韦斯特', 'Florida Keys': '佛罗里达群岛',
    'Myrtle Beach': '默特尔海滩', 'Panama City': '巴拿马城',
    'Grand Strand': '大海岸', 'Offshore': '近海',
    'Red': '红色', 'Gold': '黄金', 'Golden': '黄金', 'Silver': '银色',
    'One': '一台', 'Two': '二台', 'Three': '三台', 'Four': '四台',
    'Five': '五台', 'Six': '六台', 'Seven': '七台',
    'Box': '精选', 'Select': '精选', 'Selection': '精选',
    'United States': '美国', 'United Kingdom': '英国', 'North America': '北美',
    'South America': '南美', 'Latin America': '拉丁美洲', 'Middle East': '中东',
    'FarEast': '远东', 'Far East': '远东', 'South Asia': '南亚', 'Asia Pacific': '亚太',
    'Northern Ireland': '北爱尔兰', 'North East': '东北', 'North West': '西北',
    'South East': '东南', 'South West': '西南', 'East Midlands': '东米德兰兹',
    'West Midlands': '西米德兰兹', 'Channel Islands': '海峡群岛',
    'New Zealand': '新西兰', 'South Africa': '南非', 'South Korea': '韩国',
    'New York': '纽约', 'Los Angeles': '洛杉矶', 'San Francisco': '旧金山',
    'San Diego': '圣迭戈', 'Las Vegas': '拉斯维加斯', 'Salt Lake': '盐湖',
    'Public Access': '公众节目', 'Government Access': '政务',
    'Classic Movies': '经典电影', 'Movie Classics': '经典电影',
    'True Crime': '真实犯罪', 'Real Crime': '真实罪案', 'Cold Case': '悬案',
    'Science Fiction': '科幻', 'Sci-Fi': '科幻', 'Live Events': '现场直播',
    'Home & Garden': '家居园艺', 'Rock & Roll': '摇滚',
    'United': '联合', 'States': '州', 'America': '美国', 'American': '美国',
    'Australia': '澳大利亚', 'Canada': '加拿大', 'Canadian': '加拿大',
    'Sweden': '瑞典', 'Germany': '德国', 'German': '德国', 'France': '法国',
    'Romania': '罗马尼亚', 'Hungary': '匈牙利', 'Poland': '波兰',
    'Czech Republic': '捷克', 'Czech': '捷克', 'Turkiye': '土耳其',
    'Turkey': '土耳其', 'Denmark': '丹麦', 'Norway': '挪威',
    'Italy': '意大利', 'Spain': '西班牙', 'India': '印度',
    'Uganda': '乌干达', 'Nigeria': '尼日利亚', 'Kenya': '肯尼亚',
    'Ghana': '加纳', 'Zimbabwe': '津巴布韦', 'Zambia': '赞比亚',
    'Indonesia': '印度尼西亚', 'Vietnam': '越南', 'Thailand': '泰国',
    'Africa': '非洲', 'Asia': '亚洲', 'Europe': '欧洲', 'Arabia': '阿拉伯',
    'Bahrain': '巴林', 'Afghanistan': '阿富汗', 'Scotland': '苏格兰',
    'Wales': '威尔士', 'England': '英格兰', 'London': '伦敦',
    'Yorkshire': '约克郡', 'Cumbria': '坎布里亚', 'Florida': '佛罗里达',
    'California': '加利福尼亚', 'Texas': '得克萨斯', 'Alabama': '阿拉巴马',
    'Georgia': '佐治亚', 'Atlanta': '亚特兰大', 'Boston': '波士顿',
    'Chicago': '芝加哥', 'Miami': '迈阿密', 'Detroit': '底特律',
    'Dallas': '达拉斯', 'Austin': '奥斯汀', 'Houston': '休斯敦',
    'Denver': '丹佛', 'Seattle': '西雅图', 'Portland': '波特兰',
    'Phoenix': '菲尼克斯', 'Nashville': '纳什维尔', 'Philadelphia': '费城',
    'Sacramento': '萨克拉门托', 'Natick': '纳蒂克',
    'Educational': '教育', 'Education': '教育', 'Government': '政务',
    'Community': '社区', 'Civic': '市民', 'Public': '公共', 'Access': '公共节目',
    'Documentaries': '纪录片', 'Documentary': '纪录片', 'Discovery': '探索',
    'Entertainment': '娱乐', 'Culture': '文化', 'History': '历史',
    'Science': '科学', 'Technology': '科技', 'Business': '商业',
    'Financial': '财经', 'Finance': '财经', 'Investment': '投资',
    'News': '新闻', 'Headlines': '头条', 'Weather': '天气',
    'Sports': '体育', 'Sport': '体育', 'Football': '足球', 'Soccer': '足球',
    'Basketball': '篮球', 'Baseball': '棒球', 'Hockey': '冰球',
    'Tennis': '网球', 'Golf': '高尔夫', 'Rugby': '橄榄球',
    'Cricket': '板球', 'Boxing': '拳击', 'Wrestling': '摔跤',
    'Fishing': '钓鱼', 'Hunting': '狩猎', 'Racing': '赛车',
    'Motorsports': '赛车运动', 'Motor': '汽车', 'Moto': '摩托',
    'Auto': '汽车', 'Cars': '汽车', 'Car': '汽车', 'Aviation': '航空',
    'Outdoor': '户外', 'Outdoors': '户外', 'Adventure': '探险',
    'Nature': '自然', 'Wildlife': '野生动物', 'Wild': '野外',
    'Animal': '动物', 'Animals': '动物', 'Planet': '星球', 'Earth': '地球',
    'Pets': '宠物', 'Pet': '宠物', 'Puppies': '幼犬', 'Dogs': '狗狗',
    'Cats': '猫咪', 'Safari': '野生动物巡游', 'Beach': '海滩',
    'Travel': '旅行', 'Journey': '旅程', 'Explore': '探索',
    'Movies': '电影', 'Movie': '电影', 'Cinema': '影院', 'Film': '电影',
    'Films': '电影', 'Classic': '经典', 'Classics': '经典',
    'Action': '动作', 'Thriller': '惊悚', 'Thrillers': '惊悚',
    'Horror': '恐怖', 'Horrors': '恐怖', 'Mystery': '悬疑',
    'Mysteries': '谜案', 'Crime': '罪案', 'Drama': '剧情',
    'Dramas': '剧集', 'Series': '剧集', 'Comedy': '喜剧',
    'Comedies': '喜剧', 'Sitcoms': '情景喜剧', 'Reality': '真人秀',
    'Western': '西部', 'Westerns': '西部片', 'Romance': '爱情',
    'Romantic': '浪漫', 'Love': '爱', 'Family': '家庭',
    'Children': '儿童', 'Kids': '儿童', 'Kid': '儿童', 'Junior': '幼儿',
    'Baby': '宝宝', 'Babies': '宝宝', 'Animation': '动画',
    'Anime': '动漫', 'Cartoons': '卡通', 'Cartoon': '卡通',
    'Teen': '青少年', 'Teens': '青少年', 'Teenage': '青少年',
    'Music': '音乐', 'Musical': '音乐', 'Hits': '金曲',
    'Hit': '热门', 'Pop': '流行', 'Rock': '摇滚', 'Jazz': '爵士',
    'Classical': '古典', 'Hip Hop': '嘻哈', 'Country': '乡村',
    'Concerts': '演唱会', 'Concert': '演唱会', 'Dance': '舞蹈',
    'Metal': '金属乐', 'Soul': '灵魂乐', 'Lounge': '休闲音乐',
    'Gospel': '福音', 'Praise': '赞美', 'Worship': '敬拜',
    'Church': '教会', 'Christian': '基督教', 'Catholic': '天主教',
    'Bible': '圣经', 'Faith': '信仰', 'Prayer': '祈祷', 'Pray': '祈祷',
    'Food': '美食', 'Cooking': '烹饪', 'Kitchen': '厨房', 'Chef': '厨师',
    'Home': '家居', 'Garden': '园艺', 'Gardening': '园艺',
    'House': '房屋', 'Design': '设计', 'Lifestyle': '生活方式',
    'Life': '生活', 'Style': '时尚', 'Fashion': '时尚',
    'Shopping': '购物', 'Shop': '购物', 'Shopper': '购物',
    'Health': '健康', 'Fitness': '健身', 'Yoga': '瑜伽',
    'Wellness': '健康生活', 'Beauty': '美妆',
    'Free': '免费', 'Hour': '小时', 'Hours': '小时',
    'Replay': '精彩重播', 'Rewind': '经典回顾', 'Throwback': '怀旧',
    'Throwbacks': '怀旧', 'Collection': '精选', 'Collections': '精选',
    'Show': '秀', 'Shows': '节目', 'Funny': '搞笑', 'Fun': '趣味',
    'Videos': '视频', 'Video': '视频', 'Laughs': '欢笑',
    'Laugh': '欢笑', 'Rescue': '救援', 'Detectives': '侦探',
    'Detective': '侦探', 'Investigates': '调查', 'Investigations': '调查',
    'Investigation': '调查', 'Court': '法庭', 'Justice': '正义',
    'Police': '警察', 'Cops': '警察', 'Patrol': '巡逻',
    'America’s': '美国的', "America's": '美国的',
    'World': '世界', 'International': '国际', 'Global': '全球',
    'English': '英语', 'Local': '本地', 'Regional': '地区',
    'North': '北部', 'South': '南部', 'East': '东部', 'West': '西部',
    'Central': '中央', 'City': '城市', 'County': '县',
    'Live': '直播', 'NOW': '实时', 'Now': '实时',
    'Plus': '精选', 'Premium': '精选', 'Best': '精选',
    'Originals': '原创', 'Original': '原创', 'Exclusive': '独家',
    'Unlimited': '无限', 'Max': '精选', 'Extra': '延伸',
    'TV': '电视', 'Television': '电视', 'Channel': '频道',
    'Network': '电视网', 'Radio': '电台', 'HD': '高清', 'UHD': '超高清',
    'United States of America': '美国', 'UK': '英国版', 'US': '美国版',
    'GB': '英国版', 'CA': '加拿大版', 'DK': '丹麦版', 'NO': '挪威版',
    'AU': '澳大利亚版', 'NZ': '新西兰版', 'EN': '英语版',
}

CATEGORY_NAMES = {
    'Animation': '动画', 'Auto': '汽车', 'Business': '财经',
    'Classic': '经典影视', 'Comedy': '喜剧', 'Cooking': '美食',
    'Culture': '文化', 'Documentary': '纪录片', 'Education': '教育',
    'Entertainment': '娱乐', 'Family': '家庭', 'General': '综合',
    'Kids': '儿童', 'Legislative': '议会政务', 'Lifestyle': '生活',
    'Movies': '电影', 'Music': '音乐', 'News': '新闻', 'Outdoor': '户外',
    'Public': '公共', 'Religious': '宗教', 'Science': '科学',
    'Series': '剧集', 'Shop': '购物', 'Sports': '体育',
    'Travel': '旅游', 'Weather': '天气',
}

PHRASE_PATTERN = re.compile(r'(?<!\w)(' + '|'.join(
    re.escape(key) for key in sorted(PHRASES, key=len, reverse=True)
) + r')(?!\w)')
EXACT_PREFIXES = sorted(EXACT, key=len, reverse=True)


def split_metadata(info):
    """Find the title separator without splitting commas in quoted HTTP metadata."""
    quoted = False
    for index, character in enumerate(info):
        if character == '"':
            quoted = not quoted
        elif character == ',' and not quoted:
            return info[:index + 1], info[index + 1:].strip()
    raise ValueError('Channel metadata has no title separator')


def clean_channel_name(name):
    """Remove stream annotations, preserving numbers and regional station names."""
    name = re.sub(r'\s*[（(\[]\s*(?:\d{2,4}[pi]|[248]K|U?HD|SD|HEVC|H[. ]?26[45]|(?:Geo-blocked|Not 24/7)(?:;\s*(?:Geo-blocked|Not 24/7))*)\s*[）)\]]', '', name, flags=re.I)
    name = re.sub(r'\s+(?:[248]K|U?HD|SD|HEVC|H[. ]?26[45])(?=\s*$)', '', name, flags=re.I)
    return re.sub(r'\s+', ' ', name).strip()


def chinese_label(name, group='', channel_id=''):
    base = clean_channel_name(name)
    if SEPARATOR in base:
        base = base.split(SEPARATOR, 1)[0].strip()
    # A network brand before a known programme does not change the programme's
    # translation (e.g. MTV Catfish, PBS Antiques Roadshow).
    brand = re.match(r'^(MTV|PBS|Pluto TV|Stingray|Vevo|TVS) (.+)$', base)
    if brand and any(brand[2] == key or brand[2].startswith(key + ' ') or brand[2].startswith(key + '(') for key in EXACT_PREFIXES):
        return brand[1] + ' ' + chinese_label(brand[2], group, channel_id)
    city = re.match(r'^City of (.+?) Channel (\d+)$', base)
    if city:
        location = PHRASES.get(city[1], city[1])
        return f'{location}市第{city[2]}频道'
    # ABC identifies different broadcasters in Australia and the USA.
    if base.startswith('ABC ') and '.au' in channel_id:
        rest = base[4:]
        label = '澳大利亚广播公司' + PHRASE_PATTERN.sub(lambda m: PHRASES[m[0]], rest)
    else:
        prefix = next((key for key in EXACT_PREFIXES if base == key or base.startswith(key + ' ') or base.startswith(key + '(')), None)
        if prefix:
            rest = base[len(prefix):]
            label = EXACT[prefix] + PHRASE_PATTERN.sub(lambda m: PHRASES[m[0]], rest)
        else:
            label = PHRASE_PATTERN.sub(lambda m: PHRASES[m[0]], base)
    label = re.sub(r'\bThe\s+', '', label).replace(' & ', '与')
    if 'Movies' in group:
        label = label.replace('金曲', '热门电影')
    label = re.sub(r'\s+', ' ', label).strip(' -')
    label = re.sub(r'(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])', '', label)
    # Keep unknown proper names/call signs; add a truthful Chinese category rather
    # than inventing an official Chinese name or transliterating arbitrary codes.
    if not re.search(r'[\u3400-\u9fff]', label):
        category = next((CATEGORY_NAMES[g] for g in group.split(';') if g in CATEGORY_NAMES), '电视')
        label += ' ' + category + '频道'
    if label.endswith('电视'):
        label += '台'
    return label


def localize_metadata(info):
    prefix, title = split_metadata(info)
    attrs = dict(re.findall(r'([a-zA-Z0-9_-]+)="([^"]*)"', prefix))
    original = clean_channel_name(title.split(SEPARATOR, 1)[0])
    return prefix + original + ' ' + SEPARATOR + ' ' + chinese_label(
        original, attrs.get('group-title', ''), attrs.get('tvg-id', ''))
