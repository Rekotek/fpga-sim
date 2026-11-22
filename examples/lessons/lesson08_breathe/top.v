// Урок 8, практика 4: «дыхание» — LED0 плавно разгорается и гаснет.
// Автомат из двух состояний: ВДОХ (duty растёт) и ВЫДОХ (duty уменьшается).
// duty меняется на 1 по тику 256 раз в секунду: вдох ≈ 1 с, выдох ≈ 1 с.
// LED5 горит во время выдоха — видно, в каком состоянии автомат.
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

    // Автомат: два состояния.
    localparam S_UP   = 1'b0,   // вдох: ярче
               S_DOWN = 1'b1;   // выдох: тусклее

    reg       state = S_UP;
    reg       next;             // НЕ регистр: присваивается в always @(*)
    reg [7:0] duty  = 8'd0;     // яркость LED0: 0..255

    // Блок 1 — комбинационный: когда разворачиваться.
    always @(*) begin
        next = state;                           // по умолчанию — в ту же сторону
        case (state)
            S_UP:    if (duty == 8'd255) next = S_DOWN;   // дошли до верха
            S_DOWN:  if (duty == 8'd0)   next = S_UP;     // дошли до низа
            default: next = S_UP;
        endcase
    end

    // Блок 2 — тактовый: по тику запомнить состояние и сделать шаг duty.
    always @(posedge clk) begin
        if (tick) begin
            state <= next;
            if (next == S_UP) duty <= duty + 1'b1;
            else              duty <= duty - 1'b1;
        end
    end

    // ШИМ: счётчик + компаратор, как в практиках 1–3.
    reg [7:0] cnt = 8'd0;

    always @(posedge clk)
        cnt <= cnt + 1'b1;

    wire pwm = (cnt < duty);

    // LED0 — «дыхание», LED5 — горит на выдохе, остальные погашены.
    assign led = ~{state == S_DOWN, 4'b0000, pwm};
endmodule
