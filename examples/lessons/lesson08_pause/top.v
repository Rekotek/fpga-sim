// Урок 8, задание «Дыхание с паузой» (ключ): после выдоха LED0 полсекунды
// не горит, потом снова вдох. Автомат из трёх состояний: ВДОХ, ВЫДОХ, ПАУЗА.
// LED5 горит во время выдоха, LED4 — во время паузы.
module top #(
    parameter integer CLK_HZ = 27_000_000   // частота clk; тестбенч ставит меньше
) (
    input  wire       clk,      // 27 МГц, вывод 4
    output wire [5:0] led       // LED0..LED5, выводы 15..20, горят при 0
);
    // Делитель: тик 256 раз в секунду.
    localparam integer LAST = CLK_HZ / 256 - 1;      // 105 467 → 17 бит
    reg  [16:0] div = 17'd0;
    wire        tick = (div == LAST);

    always @(posedge clk) begin
        if (tick) div <= 17'd0;
        else      div <= div + 1'b1;
    end

    // Автомат: три состояния — нужно уже 2 бита.
    localparam [1:0] S_UP    = 2'd0,   // вдох: ярче
                     S_DOWN  = 2'd1,   // выдох: тусклее
                     S_PAUSE = 2'd2;   // пауза: погашен

    // Длина паузы в тиках: 128 / 256 = 0,5 с. Число 128 занимает 8 бит,
    // а счётчику p хватает 7: он считает 0..127 (сравниваем с T_PAUSE - 1).
    localparam [7:0] T_PAUSE = 8'd128;

    reg [1:0] state = S_UP;
    reg [1:0] next;             // НЕ регистр: присваивается в always @(*)
    reg [7:0] duty  = 8'd0;     // яркость LED0: 0..255
    reg [6:0] p     = 7'd0;     // сколько тиков прошло в этом состоянии

    // Блок 1 — комбинационный: когда разворачиваться.
    always @(*) begin
        next = state;                           // по умолчанию — в ту же сторону
        case (state)
            S_UP:    if (duty == 8'd255) next = S_DOWN;   // дошли до верха
            S_DOWN:  if (duty == 8'd0)   next = S_PAUSE;  // дошли до низа
            S_PAUSE: if (p == T_PAUSE - 1) next = S_UP;   // отдохнули
            default: next = S_UP;
        endcase
    end

    // Блок 2 — тактовый: по тику запомнить состояние и сделать шаг duty.
    always @(posedge clk) begin
        if (tick) begin
            state <= next;
            if (next == S_UP)        duty <= duty + 1'b1;
            else if (next == S_DOWN) duty <= duty - 1'b1;   // в паузе duty стоит
            if (next != state) p <= 7'd0;                   // новое состояние — отсчёт заново
            else               p <= p + 1'b1;
        end
    end

    // ШИМ: счётчик + компаратор, как в уроке.
    reg [7:0] cnt = 8'd0;

    always @(posedge clk)
        cnt <= cnt + 1'b1;

    wire pwm = (cnt < duty);

    // LED0 — «дыхание», LED5 — выдох, LED4 — пауза, остальные погашены.
    assign led = ~{state == S_DOWN, state == S_PAUSE, 3'b000, pwm};
endmodule
